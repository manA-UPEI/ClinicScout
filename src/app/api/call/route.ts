import { createSession, CallError, transition } from "@/application/call/callSessionService";
import { createMockProvider } from "@/infrastructure/call/mockCallProvider";
import { runCall } from "@/application/call/placeCallUseCase";
import type { PersonaId } from "@/infrastructure/call/mockCallProvider";

// A mock call is capped at 45s (MAX_CALL_MS) so it fits inside one request.
// A real call cannot, which is the single biggest thing Phase 2 has to solve:
// live telephony needs webhooks plus a durable session, not a held-open stream.
export const maxDuration = 60;

interface CallRequest {
  clinicId?: string;
  clinicName?: string;
  phone?: string;
  /** Must be explicitly true — see the consent check below. */
  consented?: boolean;
  /** Demo/testing only: forces which scripted receptionist answers. */
  persona?: PersonaId;
}

function bad(kind: string, message: string, status: number) {
  return Response.json({ error: { kind, message } }, { status });
}

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
  const body = (await request.json().catch(() => null)) as CallRequest | null;

  // Consent is a required field rather than an assumed default. Placing an
  // automated call is not something to fall into because a flag was missing.
  if (body?.consented !== true) {
    return bad(
      "not_consented",
      "A call can only be placed after you approve the script.",
      400
    );
  }

  const clinicName = body.clinicName?.trim();
  const phone = body.phone?.trim();
  const clinicId = body.clinicId?.trim();

  if (!clinicId || !clinicName || !phone) {
    return bad("invalid", "Missing clinic details for the call.", 400);
  }

  let session;
  try {
    session = createSession({ clinicId, clinicName, phone });
  } catch (e) {
    if (e instanceof CallError && e.kind === "already_active") {
      return bad(e.kind, e.message, 409);
    }
    throw e;
  }

  const encoder = new TextEncoder();
  const provider = createMockProvider(
    body.persona ? { persona: body.persona } : {}
  );

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // The client going away is a hang-up, not just a dead socket: the person
      // the agent was speaking for has left, so the call should end too.
      const hangup = new AbortController();
      const onAbort = () => {
        closed = true;
        hangup.abort();
      };
      request.signal.addEventListener("abort", onAbort);

      send("session", { id: session.id, clinicName: session.clinicName });

      try {
        await runCall(
          session,
          provider,
          (event) => send(event.kind, event),
          hangup.signal
        );
      } catch (e) {
        console.error("Unexpected call failure:", e);
        // Leave the session in a terminal state rather than stuck mid-call,
        // so the one-active-call-per-clinic rail cannot deadlock a clinic.
        try {
          transition(session, "failed");
        } catch {
          // Already terminal — nothing to correct.
        }
        send("error", {
          kind: "failed",
          message: "The call ended unexpectedly.",
        });
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        if (!closed) controller.close();
        closed = true;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
