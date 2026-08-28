import { runClinicSearch } from "@/application/search/runClinicSearchUseCase";
import { parseSearchRequest } from "@/application/search/parseSearchRequest";
import { AgentError } from "@/domain/entities/errors";
import type { AgentStep } from "@/domain/entities/agentRun";
import { createSseResponse } from "@/interface/http/sseResponse";
import { badRequest } from "@/interface/http/errors";
import { generateRequestId } from "@/interface/http/requestId";
import { enforceRateLimit } from "@/interface/http/rateLimitGate";
import { logger } from "@/infrastructure/logging/logger";

// The agent loop budgets 40s for itself and still needs to answer afterwards.
// Vercel's Hobby plan caps a function at 60s, which is the real ceiling here.
export const maxDuration = 60;

// Discovery runs server-side: browsers forbid setting the User-Agent header
// that the Nominatim and Overpass usage policies require, and this keeps the
// upstream services off the client's origin entirely.
export async function POST(request: Request) {
  const requestId = generateRequestId();

  // How much this caller gets depends on how well they are identified —
  // see domain/policies/rateLimitTiers.ts. The limits themselves no longer
  // live here, because there is now more than one of them per route.
  const gate = await enforceRateLimit("search", request, requestId);
  if (!gate.allowed) return gate.response;

  const body = await request.json().catch(() => null);

  const parsed = parseSearchRequest(body);
  if (!parsed.ok)
    return badRequest(parsed.kind, parsed.message, parsed.status, requestId, gate.headers);
  const input = parsed.request;

  // Streamed rather than returned whole: an agent run's length depends on how
  // many tools it decides to call, so the old "wait, then replay a canned
  // animation" approach would leave the user on a static spinner for an
  // unpredictable stretch. Now each decision appears as it is made.
  return createSseResponse(
    request.signal,
    async (send) => {
      try {
        const onStep = (step: AgentStep) => send("step", step);
        const result = await runClinicSearch(input, onStep);
        send("result", result);
      } catch (e) {
        if (e instanceof AgentError) {
          send("error", { kind: e.kind, message: e.message, requestId });
        } else {
          logger.error({ requestId, err: e }, "Unexpected search failure");
          send("error", {
            kind: "network",
            message: "An unexpected error occurred. Please try again.",
            requestId,
          });
        }
      }
    },
    gate.headers
  );
}
