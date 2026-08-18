"use client";

import { useCallback, useRef } from "react";
import { postAndStream } from "@/shared/sse/postAndStream";
import type { StreamedError } from "@/shared/sse/postAndStream";
import type { SseEvent } from "@/shared/sse/sseFrame";

export interface RunHandlers {
  onEvent: (event: SseEvent) => void;
  /** A parseable server error, or a transport/network failure. */
  onError: (error: StreamedError) => void;
  /** The caller's own abort() resolved the request — distinct from onError, since it isn't a failure. */
  onAborted?: () => void;
  /** Shown when the response wasn't a stream and carried no parseable `error`. */
  fallbackErrorMessage: string;
  /** Shown when the fetch itself failed for a reason other than the caller's own abort(). */
  networkErrorMessage: string;
}

/**
 * Owns one POST-and-stream-SSE request's AbortController, so a component
 * doesn't need its own `useRef<AbortController>` bookkeeping. Wraps
 * shared/sse/postAndStream.ts — the fetch/content-type/SSE-loop logic itself
 * lives there, framework-agnostic; this hook only adds the React-specific
 * controller lifecycle and dispatches to the handlers a caller supplies.
 */
export function useStreamedSse() {
  const controllerRef = useRef<AbortController | null>(null);

  const run = useCallback(async (url: string, body: unknown, handlers: RunHandlers) => {
    const controller = new AbortController();
    controllerRef.current = controller;

    const outcome = await postAndStream(url, {
      body,
      signal: controller.signal,
      onEvent: handlers.onEvent,
      fallbackError: { message: handlers.fallbackErrorMessage },
      networkError: { message: handlers.networkErrorMessage },
    });

    controllerRef.current = null;

    if (outcome.kind === "error") handlers.onError(outcome.error);
    else if (outcome.kind === "aborted") handlers.onAborted?.();
    // outcome.kind === "ok": the caller's own onEvent handling already
    // reflected completion (e.g. an "outcome" or "result" event) — nothing
    // further to signal here.
  }, []);

  const abort = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return { run, abort };
}
