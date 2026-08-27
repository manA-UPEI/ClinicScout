import { getCurrentUser, isSignInAvailable } from "../../application/auth/getCurrentUser.ts";
import {
  globalTierFor,
  signingInWouldRaiseLimit,
  tierFor,
  type RateLimitedRoute,
  type RateLimitRule,
} from "../../domain/policies/rateLimitTiers.ts";
import { createRateLimiter } from "../../infrastructure/ratelimit/createRateLimiter.ts";
import type { RateLimiter, RateLimitResult } from "../../infrastructure/ratelimit/rateLimiter.ts";
import { logger } from "../../infrastructure/logging/logger.ts";
import { clientIp } from "./clientIp.ts";
import { serviceAtCapacity, tooManyRequests } from "./errors.ts";
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

function limiterFor(namespace: string, rule: RateLimitRule): RateLimiter {
  const existing = limiters.get(namespace);
  if (existing) return existing;

  const limiter = createRateLimiter(namespace, rule.limit, rule.windowMs);
  limiters.set(namespace, limiter);
  return limiter;
}

/** The whole deployment counts against one key; the namespace is what keeps it apart from the per-caller buckets. */
const GLOBAL_KEY = "all";

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

const AT_CAPACITY: Record<RateLimitedRoute, string> = {
  search:
    "ClinicScout is handling as many searches as it can right now. This isn't " +
    "you — please try again in a few minutes.",
  call:
    "ClinicScout is handling as many calls as it can right now. This isn't " +
    "you — please try again in a few minutes.",
};

/**
 * The rate-limit check both SSE routes run before doing any work.
 *
 * Two checks, and the order is the whole design.
 *
 * The caller's own limit goes first. Reversing it would let one attacker
 * empty the server-wide bucket: every one of their thousand requests would
 * consume a global token before their personal limit got a chance to reject
 * them, and a single caller could deny the service to everyone. Checking
 * personal first means an abusive caller is stopped at their own ceiling and
 * never touches the shared budget beyond the allowance they were entitled to.
 *
 * That order has a cost, and it is worth naming rather than hiding: a request
 * rejected for capacity has already spent one of the caller's own tokens. So
 * during a sustained overload a visitor can burn through their personal
 * allowance without a single successful search. The alternative — a peek, or
 * refunding the token — adds a round trip and a race for a fairness problem
 * that only appears while the service is already degraded, and it is the
 * strictly better trade against one attacker being able to lock everybody
 * out.
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

  const personal = await limiterFor(
    `${route}:${subject.kind}`,
    tierFor(route, subject.kind)
  ).consume(subject.key);

  if (!personal.allowed) {
    logger.warn(
      { requestId, route, subjectKind: subject.kind, limit: personal.limit },
      "Rate limit exceeded"
    );
    return {
      allowed: false,
      response: tooManyRequests(
        message(route, subject),
        personal.retryAfterMs,
        requestId,
        headersFor(personal, true)
      ),
    };
  }

  const global = await limiterFor(`${route}:global`, globalTierFor(route)).consume(
    GLOBAL_KEY
  );

  if (!global.allowed) {
    // Logged at error, not warn: a caller hitting their own limit is the
    // system working, while the deployment hitting its ceiling is something
    // an operator should actually see and decide about.
    logger.error(
      { requestId, route, limit: global.limit },
      "Server-wide rate limit exceeded — requests are being shed"
    );
    return {
      allowed: false,
      response: serviceAtCapacity(AT_CAPACITY[route], global.retryAfterMs, requestId),
    };
  }

  return { allowed: true, headers: headersFor(personal, false), subject };
}
