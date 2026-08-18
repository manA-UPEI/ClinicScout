export interface SseEvent {
  event: string;
  data: unknown;
}

/**
 * Parses one `event:`/`data:` frame. Pure, so the framing logic is testable
 * without a live stream.
 *
 * Per the SSE spec a frame may carry several `data:` lines, which are joined
 * with newlines. Our server never splits a payload that way, but a parser that
 * assumed one line would corrupt the JSON if it ever did.
 */
export function parseSseFrame(frame: string): SseEvent | null {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }

  if (dataLines.length === 0) return null;

  try {
    return { event, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

/**
 * Yields events from an SSE response body.
 *
 * `EventSource` would normally do this, but it can only issue GET requests and
 * this search is a POST, so the stream is read and framed by hand.
 */
export async function* readSseStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseFrame(frame);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}
