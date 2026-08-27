import { getCurrentUser, isSignInAvailable } from "../../application/auth/getCurrentUser.ts";
import {
  signingInWouldRaiseLimit,
  tierFor,
  type RateLimitedRoute,
} from "../../domain/policies/rateLimitTiers.ts";
import { createRateLimiter } from "../../infrastructure/ratelimit/createRateLimiter.ts";
import type { RateLimiter, RateLimitResult } from "../../infrastructure/ratelimit/rateLimiter.ts";
import { logger } from "../../infrastructure/logging/logger.ts";
import { clientIp } from "./clientIp.ts";
import { tooManyRequests } from "./errors.ts";
import { resolveSubject, type RateLimitSubject } from "./rateLimitSubject.ts";

export type RateLimitDecision =
  | { allowed: false; response: Response }
  | { allowed: true; headers: Record<string, string>; subject: RateLimitSubject };

/**
 * One limiter per route *and* tier, because the limit is baked into the
 * limiter. Keyed by both so a signed-in caller's count and an address's count
 * are separate Redis keys — without the tier in the namespace, a user id that
 * happened to look like an address would share its bucket.
 *
 * Built lazily and cached for the life of the process, which is what the
 * route handlers previously did at module scope.
 */
const limiters = new Map<string, RateLimiter>();

function limiterFor(route: RateLimitedRoute, subject: RateLimitSubject): RateLimiter {
  const namespace = `${route}:${subject.kind}`;
  const existing = limiters.get(namespace);
  if (existing) return existing;

  const { limit, windowMs } = tierFor(route, subject.kind);
  const limiter = createRateLimiter(namespace, limit, windowMs);
  limiters.set(namespace, limiter);
  return limiter;
}

/**
 * The standard RateLimit-* family, minus one field.
 *
 * `RateLimit-Reset` is emitted only on a rejection, where `retryAfterMs` is a
 * measured value. On a successful call the fixed-window limiters know the
 * count but not how much of the window is left, so any Reset here would be a
 * guess dressed as a measurement — and an app that renders an unverified
 * clinic fact as "Unknown" should not invent a header either.
 */
function headersFor(result: RateLimitResult, rejected: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
  };
  if (rejected) {
    headers["RateLimit-Reset"] = String(Math.ceil(result.retryAfterMs / 1000));
  }
  return headers;
}

const EXHAUSTED: Record<RateLimitedRoute, string> = {
  search: "You've made a lot of searches in a short time.",
  call: "You've placed a lot of calls in a short time.",
};

/**
 * Tells an anonymous caller the one thing that would actually help, and only
 * when it would: a deployment with no OAuth configured has no sign-in to
 * offer, and a signed-in caller who has already hit their ceiling does not
 * need to be told to sign in again.
 */
function message(route: RateLimitedRoute, subject: RateLimitSubject): string {
  const base = `${EXHAUSTED[route]} Please wait a bit and try again.`;
  const canHelp = signingInWouldRaiseLimit(route, subject.kind) && isSignInAvailable();
  return canHelp ? `${base} Signing in raises this limit.` : base;
}

/**
 * The rate-limit check both SSE routes run before doing any work.
 *
 * Runs before body parsing, as it did before: a request that will be rejected
 * anyway should not get to spend the server's time being validated first.
 *
 * The subject kind is logged on every rejection but the key never is — the
 * useful operational question is "which tier is absorbing this", and an
 * account id or an address in a log line is personal data this app has no
 * reason to keep.
 */
export async function enforceRateLimit(
  route: RateLimitedRoute,
  request: Request,
  requestId: string
): Promise<RateLimitDecision> {
  const user = await getCurrentUser();
  const subject = resolveSubject(user, clientIp(request));
  const result = await limiterFor(route, subject).consume(subject.key);

  if (result.allowed) {
    return { allowed: true, headers: headersFor(result, false), subject };
  }

  logger.warn(
    { requestId, route, subjectKind: subject.kind, limit: result.limit },
    "Rate limit exceeded"
  );

  return {
    allowed: false,
    response: tooManyRequests(
      message(route, subject),
      result.retryAfterMs,
      requestId,
      headersFor(result, true)
    ),
  };
}
