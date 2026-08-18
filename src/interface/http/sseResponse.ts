export type Send = (event: string, data: unknown) => void;

/**
 * Wraps a streaming handler in a Server-Sent-Events Response, owning the
 * ReadableStream/encoder/abort-listener/close boilerplate both /api/search
 * and /api/call otherwise repeat. `run` receives a `send(event, data)`
 * function and the request's abort signal; whatever it does is streamed to
 * the client until it resolves, at which point the stream closes.
 *
 * If the client disconnects mid-run (navigates away, hangs up), further
 * `send` calls are silently dropped rather than throwing into a dead stream.
 */
export function createSseResponse(
  requestSignal: AbortSignal,
  run: (send: Send, signal: AbortSignal) => Promise<void>
): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send: Send = (event, data) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      const abort = () => {
        closed = true;
      };
      requestSignal.addEventListener("abort", abort);

      try {
        await run(send, requestSignal);
      } finally {
        requestSignal.removeEventListener("abort", abort);
        if (!closed) controller.close();
        closed = true;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      // no-transform matters as much as no-cache: a proxy that buffers or
      // rewrites the body would defeat the streaming entirely.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
