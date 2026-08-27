import type { AuthenticatedUser } from "../../domain/entities/user.ts";
import type { SubjectKind } from "../../domain/policies/rateLimitTiers.ts";

export interface RateLimitSubject {
  kind: SubjectKind;
  /** The bucket key. Namespaced by kind at the limiter, so a user id and an address can never collide. */
  key: string;
}

/** The single bucket every unidentifiable caller shares. */
const SHARED_UNIDENTIFIED_KEY = "shared";

/**
 * Decides which bucket a request counts against.
 *
 * A verified session beats an address whenever there is one: it survives the
 * caller changing networks, it cannot be forged by setting a header, and it
 * is the thing the higher tier is actually extending trust to.
 *
 * Falling all the way through lands every such caller in one shared bucket.
 * The tempting alternative — a fresh key per request — reads like fairness
 * and is actually the absence of a limit, since anyone could opt out by
 * dropping a header. See SubjectKind in domain/policies/rateLimitTiers.ts.
 *
 * Pure, and takes the already-resolved user and address rather than a
 * Request, so the decision is testable without constructing one.
 */
export function resolveSubject(
  user: AuthenticatedUser | null,
  forwardedIp: string | null
): RateLimitSubject {
  if (user) return { kind: "user", key: user.id };
  if (forwardedIp) return { kind: "ip", key: forwardedIp };
  return { kind: "unidentified", key: SHARED_UNIDENTIFIED_KEY };
}
