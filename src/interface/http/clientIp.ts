/**
 * Best-effort client identity for rate limiting. Vercel (and most proxies)
 * set `x-forwarded-for` to a comma-separated list with the original client
 * first; there is no other way to see the caller's address from a Next.js
 * route handler, since `request` itself carries no socket info.
 *
 * Spoofable by anyone calling the API directly rather than through the
 * deployed proxy — acceptable for its purpose here (slowing down accidental
 * hammering of a quota-limited route), not a security boundary.
 *
 * Returns null rather than a placeholder string when there is no address to
 * read. The caller has to decide what an unidentifiable request is worth, and
 * a stringly-typed "unknown" invites it being used as a key by accident —
 * see interface/http/rateLimitSubject.ts, which makes that a named tier
 * instead.
 */
export function clientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || null;
}
