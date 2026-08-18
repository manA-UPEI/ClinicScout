import { createSession, CallError, transition } from "@/application/call/callSessionService";
import { createMockProvider } from "@/infrastructure/call/mockCallProvider";
import { runCall } from "@/application/call/placeCallUseCase";
import { parseCallRequest } from "@/application/call/parseCallRequest";
import type { CallRequestBody } from "@/application/call/parseCallRequest";
import { createSseResponse } from "@/interface/http/sseResponse";
import { badRequest, tooManyRequests } from "@/interface/http/errors";
import { clientIp } from "@/interface/http/clientIp";
import { generateRequestId } from "@/interface/http/requestId";
import { createRateLimiter } from "@/infrastructure/ratelimit/createRateLimiter";
import { logger } from "@/infrastructure/logging/logger";

// A mock call is capped at 45s (MAX_CALL_MS) so it fits inside one request.
// A real call cannot, which is the single biggest thing Phase 2 has to solve:
// live telephony needs webhooks plus a durable session, not a held-open stream.
export const maxDuration = 60;

// A call runs up to MAX_CALL_MS plus a Gemini extraction pass at the end.
// callSessionService's one-active-call-per-clinic rail already stops a
// clinic being dialled twice at once; this stops one visitor from starting
// call after call. Eight per ten minutes allows working through a short
// list of real candidates in one sitting.
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const limiter = createRateLimiter("call", RATE_LIMIT, RATE_WINDOW_MS);

/**
 * Places a call to a clinic and streams the conversation back as it happens.
 *
 * Same shape as /api/search — POST plus an SSE body — for the same reason: the
 * length of a call is not knowable up front, and a user watching an agent
 * speak on their behalf should see the words as they are said rather than a
 * spinner followed by a summary.
 *
 * Hanging up is the client aborting the fetch. That arrives here as
 * `request.signal`, which is forwarded into the provider, so ending the call
 * needs no separate endpoint and cannot get out of sync with the stream.
 */
export async function POST(request: Request) {
  const requestId = generateRequestId();

  const { allowed, retryAfterMs } = await limiter.consume(clientIp(request));
  if (!allowed) {
    return tooManyRequests(
      "You've placed a lot of calls in a short time. Please wait a bit and try again.",
      retryAfterMs,
      requestId
    );
  }

  const body = (await request.json().catch(() => null)) as CallRequestBody | null;

  const parsed = parseCallRequest(body);
  if (!parsed.ok) return badRequest(parsed.kind, parsed.message, parsed.status, requestId);
  const { clinicId, clinicName, phone, persona } = parsed.request;

  let session;
  try {
    session = await createSession({ clinicId, clinicName, phone });
  } catch (e) {
    if (e instanceof CallError && e.kind === "already_active") {
      return badRequest(e.kind, e.message, 409, requestId);
    }
    throw e;
  }

  const provider = createMockProvider(persona ? { persona } : {});

  return createSseResponse(request.signal, async (send, signal) => {
    // The client going away is a hang-up, not just a dead socket: the person
    // the agent was speaking for has left, so the call should end too.
    const hangup = new AbortController();
    signal.addEventListener("abort", () => hangup.abort());

    send("session", { id: session.id, clinicName: session.clinicName });

    try {
      await runCall(
        session,
        provider,
        (event) => send(event.kind, event),
        hangup.signal
      );
    } catch (e) {
      logger.error({ requestId, err: e }, "Unexpected call failure");
      // Leave the session in a terminal state rather than stuck mid-call,
      // so the one-active-call-per-clinic rail cannot deadlock a clinic.
      try {
        await transition(session, "failed");
      } catch {
        // Already terminal — nothing to correct.
      }
      send("error", {
        kind: "failed",
        message: "The call ended unexpectedly.",
        requestId,
      });
    }
  });
}
