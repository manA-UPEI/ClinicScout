/** Shared shape for a non-stream JSON error response, used by both route handlers before their SSE body opens. */
export function badRequest(
  kind: string,
  message: string,
  status: number,
  requestId?: string
): Response {
  return Response.json({ error: { kind, message, requestId } }, { status });
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
