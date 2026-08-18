/** Shared shape for a non-stream JSON error response, used by both route handlers before their SSE body opens. */
export function badRequest(kind: string, message: string, status: number): Response {
  return Response.json({ error: { kind, message } }, { status });
}
