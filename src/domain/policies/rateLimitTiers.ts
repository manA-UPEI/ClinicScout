/** The two routes expensive enough to be worth limiting. `/api/health` is neither. */
export type RateLimitedRoute = "search" | "call";

/**
 * How well the caller is identified, in descending order of trust.
 *
 * - `user` — a verified session. The strongest key there is: it survives a
 *   changed IP, and it cannot be spoofed without the session cookie.
 * - `ip` — an anonymous caller with a forwarded address. Spoofable by anyone
 *   talking to the deployment directly rather than through its proxy, so it
 *   slows accidental hammering rather than a determined attacker.
 * - `unidentified` — no session and no forwarded address at all. Every such
 *   caller shares one bucket. That is deliberate: they are indistinguishable,
 *   so the alternative is a per-request key, which is the same as no limit —
 *   and "omit a header to opt out of rate limiting" is not a limit. Sharing
 *   fails closed. On a correctly proxied deployment this tier should be
 *   almost empty; if it is not, the proxy is not forwarding addresses.
 */
export type SubjectKind = "user" | "ip" | "unidentified";

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

const TEN_MINUTES_MS = 10 * 60 * 1000;

/**
 * What each class of caller gets per route.
 *
 * The anonymous numbers are exactly what both routes enforced before accounts
 * existed, and that is intentional: signing in is worth doing because it
 * raises your ceiling, not because the app quietly lowered everyone else's.
 * A change that made the app worse for visitors who did nothing wrong would
 * be a strange way to introduce accounts.
 *
 * The signed-in numbers are higher because the key is better, not because the
 * work is cheaper. A session id cannot be rotated the way an address can, so
 * a signed-in abuser is both easier to spot and easier to stop — which is
 * what justifies extending more trust in the first place.
 *
 * `unidentified` matches `ip` rather than undercutting it. Tightening a
 * shared bucket punishes everyone in it for the noisiest member, and the
 * tier's whole purpose is to fail closed, not to be punitive.
 *
 * Windows are equal across tiers on purpose: a caller who signs in mid-window
 * moves to a different bucket, and differing windows would make "when does
 * this reset" unanswerable in the one place it is asked — the Retry-After.
 */
const TIERS: Record<RateLimitedRoute, Record<SubjectKind, RateLimitRule>> = {
  // A run costs up to ~6 Gemini calls plus a Nominatim and an Overpass
  // request — the most expensive thing the app does, and the fastest way to
  // exhaust the pinned model's free-tier quota.
  search: {
    user: { limit: 20, windowMs: TEN_MINUTES_MS },
    ip: { limit: 5, windowMs: TEN_MINUTES_MS },
    unidentified: { limit: 5, windowMs: TEN_MINUTES_MS },
  },
  // A call runs up to MAX_CALL_MS plus an extraction pass. The
  // one-active-call-per-clinic rail already stops a clinic being dialled
  // twice at once; this stops one visitor starting call after call.
  call: {
    user: { limit: 20, windowMs: TEN_MINUTES_MS },
    ip: { limit: 8, windowMs: TEN_MINUTES_MS },
    unidentified: { limit: 8, windowMs: TEN_MINUTES_MS },
  },
};

/**
 * The ceiling for the whole deployment, regardless of who is asking.
 *
 * The per-caller tiers above stop one visitor hammering a route. They do
 * nothing about the case that actually exhausts a free-tier quota: many
 * distinct callers, each politely under their own limit, adding up. Two
 * hundred people taking five searches each is a thousand searches, and every
 * one of them is within the rules.
 *
 * The numbers come from the binding upstream constraint, not from taste. A
 * search spends up to ~6 Gemini calls; a free-tier key allows on the order of
 * 15 requests per minute, so roughly 2.5 searches a minute is what the quota
 * actually sustains — about 25 in a ten-minute window. 30 leaves a little
 * headroom, since not every run uses its full turn budget. Calls spend one
 * extraction each and are bounded more by holding a 60s function open than by
 * quota.
 *
 * If you are on paid quota, this is the arithmetic to redo — it is the one
 * number here that is a property of your API key rather than of the app.
 *
 * Nominatim and Overpass are not the constraint at this scale: 30 searches
 * per ten minutes is 0.05 requests a second against Nominatim's stated
 * ceiling of one.
 */
const GLOBAL_TIERS: Record<RateLimitedRoute, RateLimitRule> = {
  search: { limit: 30, windowMs: TEN_MINUTES_MS },
  call: { limit: 20, windowMs: TEN_MINUTES_MS },
};

export function tierFor(route: RateLimitedRoute, kind: SubjectKind): RateLimitRule {
  return TIERS[route][kind];
}

export function globalTierFor(route: RateLimitedRoute): RateLimitRule {
  return GLOBAL_TIERS[route];
}

/** Whether signing in would actually buy this caller a higher ceiling — the only case where saying so in a 429 is useful rather than noise. */
export function signingInWouldRaiseLimit(
  route: RateLimitedRoute,
  kind: SubjectKind
): boolean {
  return kind !== "user" && tierFor(route, "user").limit > tierFor(route, kind).limit;
}
