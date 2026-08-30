import { readSseStream } from "./sseFrame.ts";
import type { SseEvent } from "./sseFrame.ts";

export interface StreamedError {
  kind?: string;
  message: string;
  /** Short id the server logged alongside this failure, so it can be quoted back for support. */
  requestId?: string;
}

export type PostAndStreamOutcome =
  | { kind: "ok" }
  | { kind: "aborted" }
  | { kind: "error"; error: StreamedError };

export interface PostAndStreamOptions {
  body: unknown;
  signal: AbortSignal;
  onEvent: (event: SseEvent) => void;
  /** Shown when the response wasn't a stream and carried no parseable `error` field — e.g. request validation failed before a run could start. */
  fallbackError: StreamedError;
  /** Shown when the fetch itself failed for a reason other than the caller's own abort. */
  networkError: StreamedError;
}

/**
 * POSTs JSON to `url` and streams back SSE events one frame at a time.
 *
 * Framework-agnostic on purpose: this function is the shared piece — the
 * fetch + content-type check + SSE read loop — that `components/hooks/
 * useStreamedSse.ts` and any future caller wrap with their own local
 * phase/state shape, rather than forcing one React hook's state shape onto
 * every caller.
 */
export async function postAndStream(
  url: string,
  options: PostAndStreamOptions
): Promise<PostAndStreamOutcome> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: options.signal,
      body: JSON.stringify(options.body),
    });

    // Input validation still answers with plain JSON — there is nothing to
    // stream when the request never starts a run.
    if (!response.body || !response.headers.get("Content-Type")?.includes("event-stream")) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: StreamedError }
        | null;
      return { kind: "error", error: payload?.error?.message ? payload.error : options.fallbackError };
    }

    for await (const event of readSseStream(response.body)) {
      options.onEvent(event);
    }
    return { kind: "ok" };
  } catch {
    // An abort is the caller hanging up deliberately, not a transport
    // failure — the caller decides whether that's worth surfacing.
    if (options.signal.aborted) return { kind: "aborted" };
    return { kind: "error", error: options.networkError };
  }
}
