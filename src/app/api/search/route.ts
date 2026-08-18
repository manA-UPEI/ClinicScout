import { runClinicSearch } from "@/application/search/runClinicSearchUseCase";
import { AgentError } from "@/domain/entities/errors";
import type { AgentStep } from "@/domain/entities/agentRun";
import { createSseResponse } from "@/interface/http/sseResponse";

// The agent loop budgets 40s for itself and still needs to answer afterwards.
// Vercel's Hobby plan caps a function at 60s, which is the real ceiling here.
export const maxDuration = 60;

// Discovery runs server-side: browsers forbid setting the User-Agent header
// that the Nominatim and Overpass usage policies require, and this keeps the
// upstream services off the client's origin entirely.
export async function POST(request: Request) {
  const input = await request.json().catch(() => null);

  if (!input?.location?.trim()) {
    return Response.json(
      { error: { kind: "location_not_found", message: "Please enter a location." } },
      { status: 400 }
    );
  }

  // Streamed rather than returned whole: an agent run's length depends on how
  // many tools it decides to call, so the old "wait, then replay a canned
  // animation" approach would leave the user on a static spinner for an
  // unpredictable stretch. Now each decision appears as it is made.
  return createSseResponse(request.signal, async (send) => {
    try {
      const onStep = (step: AgentStep) => send("step", step);
      const result = await runClinicSearch(input, onStep);
      send("result", result);
    } catch (e) {
      if (e instanceof AgentError) {
        send("error", { kind: e.kind, message: e.message });
      } else {
        console.error("Unexpected search failure:", e);
        send("error", {
          kind: "network",
          message: "An unexpected error occurred. Please try again.",
        });
      }
    }
  });
}
