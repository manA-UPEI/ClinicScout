/**
 * Shared shape for a non-stream JSON error response, used by both route
 * handlers before their SSE body opens.
 *
 * Carries the gate's RateLimit-* headers because every caller of this sits
 * *past* the rate-limit check: the gate runs before body parsing, so a
 * request rejected here has already spent one of the caller's tokens.
 * Omitting the headers left a client that sends a malformed body burning its
 * allowance with no way to see what was left — the one response class where
 * the count moved but nothing said so.
 */
export function badRequest(
  kind: string,
  message: string,
  status: number,
  requestId?: string,
  rateLimitHeaders: Record<string, string> = {}
): Response {
  return Response.json(
    { error: { kind, message, requestId } },
    { status, headers: rateLimitHeaders }
  );
}

/** Same shape as badRequest, plus the Retry-After header the 429 status implies and whatever RateLimit-* headers the gate measured. */
export function tooManyRequests(
  message: string,
  retryAfterMs: number,
  requestId?: string,
  rateLimitHeaders: Record<string, string> = {}
): Response {
  return Response.json(
    { error: { kind: "rate_limited", message, requestId } },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
        ...rateLimitHeaders,
      },
    }
  );
}

/**
 * The deployment as a whole is at its ceiling, not this caller.
 *
 * 503 rather than another 429 on purpose. 429 means "you have sent too many
 * requests", which would be a lie told to someone on their first search of
 * the day, and it would train them to slow down when slowing down is not the
 * fix. 503 with Retry-After says the honest thing: the service is
 * temporarily unable, try again shortly.
 *
 * No RateLimit-* headers here. Those describe the caller's own allowance,
 * which is untouched and still has room — attaching capacity numbers to them
 * would mean two different limits sharing one header family, and would
 * publish exactly how close the deployment is to its ceiling.
 */
export function serviceAtCapacity(
  message: string,
  retryAfterMs: number,
  requestId?: string
): Response {
  return Response.json(
    { error: { kind: "at_capacity", message, requestId } },
    {
      status: 503,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
    }
  );
}
