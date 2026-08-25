import { runClinicSearch } from "@/application/search/runClinicSearchUseCase";
import { parseSearchRequest } from "@/application/search/parseSearchRequest";
import { AgentError } from "@/domain/entities/errors";
import type { AgentStep } from "@/domain/entities/agentRun";
import { createSseResponse } from "@/interface/http/sseResponse";
import { badRequest, tooManyRequests } from "@/interface/http/errors";
import { clientIp } from "@/interface/http/clientIp";
import { generateRequestId } from "@/interface/http/requestId";
import { createRateLimiter } from "@/infrastructure/ratelimit/createRateLimiter";
import { logger } from "@/infrastructure/logging/logger";

// The agent loop budgets 40s for itself and still needs to answer afterwards.
// Vercel's Hobby plan caps a function at 60s, which is the real ceiling here.
export const maxDuration = 60;

// A run costs up to ~6 Gemini calls plus a Nominatim and an Overpass
// request — the most expensive route in the app, and the one that burns the
// pinned model's free-tier quota fastest (see README's quota notes). Five
// per ten minutes comfortably covers retyping a mistyped location a couple
// of times while still stopping a refresh loop or a script.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const limiter = createRateLimiter("search", RATE_LIMIT, RATE_WINDOW_MS);

// Discovery runs server-side: browsers forbid setting the User-Agent header
// that the Nominatim and Overpass usage policies require, and this keeps the
// upstream services off the client's origin entirely.
export async function POST(request: Request) {
  const requestId = generateRequestId();

  const { allowed, retryAfterMs } = await limiter.consume(clientIp(request));
  if (!allowed) {
    return tooManyRequests(
      "You've made a lot of searches in a short time. Please wait a bit and try again.",
      retryAfterMs,
      requestId
    );
  }

  const body = await request.json().catch(() => null);

  const parsed = parseSearchRequest(body);
  if (!parsed.ok) return badRequest(parsed.kind, parsed.message, parsed.status, requestId);
  const input = parsed.request;

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
  });
}
