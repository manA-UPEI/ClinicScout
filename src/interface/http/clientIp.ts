/**
 * Best-effort client identity for rate limiting. Vercel (and most proxies)
 * set `x-forwarded-for` to a comma-separated list with the original client
 * first; there is no other way to see the caller's address from a Next.js
 * route handler, since `request` itself carries no socket info.
 *
 * Spoofable by anyone calling the API directly rather than through the
 * deployed proxy — acceptable for its purpose here (slowing down accidental
 * hammering of a quota-limited route), not a security boundary.
 */
export function clientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const first = forwardedFor?.split(",")[0]?.trim();
  return first || "unknown";
}
