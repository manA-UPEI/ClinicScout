import type { AgentRunResult, AgentStep, InputFormData } from "../../domain/entities/agentRun.ts";
import { geminiConfigured } from "../../infrastructure/llm/createJsonExtractionModel.ts";
import { fixturesEnabled } from "../../infrastructure/config/fixtureMode.ts";
import { createCallable } from "../../infrastructure/llm/createFunctionCallingModel.ts";
import { runDeterministicPipeline } from "./runDeterministicPipelineUseCase.ts";
import { runGeminiAgent, SYSTEM_INSTRUCTION } from "./runGeminiAgentUseCase.ts";
import { TOOL_DECLARATIONS } from "./tools/index.ts";

/** Why the orchestrator was skipped or abandoned, phrased for the user. */
const FALLBACK_NOTE: Record<string, string> = {
  no_api_key:
    "🧭 No GEMINI_API_KEY set — running the built-in search pipeline instead of the agent.",
  quota:
    "🧭 The AI quota is exhausted right now — falling back to the built-in search pipeline.",
  network: "🧭 Couldn't reach the AI model — falling back to the built-in search pipeline.",
};

function fallbackNote(reason: string): string {
  return (
    FALLBACK_NOTE[reason] ??
    "🧭 The agent couldn't complete its reasoning — falling back to the built-in search pipeline."
  );
}

/**
 * Entry point for a search. Prefers the Gemini orchestrator and falls back to
 * the original fixed pipeline whenever the agent cannot answer — no key, no
 * network, quota exhausted, or out of time.
 *
 * The fallback is always announced in the step log rather than swapped in
 * silently: which engine answered is exactly the sort of thing this app is
 * otherwise careful to be explicit about.
 */
export async function runClinicSearch(
  input: InputFormData,
  onStep: (step: AgentStep) => void = () => {}
): Promise<AgentRunResult> {
  // Every streamed step is also collected, so the final payload is complete on
  // its own for a client that joined late or dropped an event.
  const steps: AgentStep[] = [];
  const emit = (step: AgentStep) => {
    steps.push(step);
    onStep(step);
  };

  // First line of the transparency log, before anything else it says about
  // the run — the log is where this app explains where every fact came from,
  // so "all of them are invented" belongs at the top of it rather than
  // somewhere further down among the real-looking steps.
  if (fixturesEnabled()) {
    emit({
      id: "fixtures",
      message:
        "🧪 Fixture mode — clinics, websites and model replies are all canned test data, not real.",
    });
  }

  if (!geminiConfigured()) {
    emit({ id: "mode", message: fallbackNote("no_api_key") });
    const result = await runDeterministicPipeline(input, emit);
    return { ...result, steps };
  }

  emit({ id: "mode", message: "🤖 Gemini agent planning the search..." });

  const outcome = await runGeminiAgent({
    input,
    callModel: createCallable({
      systemInstruction: SYSTEM_INSTRUCTION,
      functionDeclarations: TOOL_DECLARATIONS,
    }),
    onStep: emit,
  });

  if (outcome.ok) return { ...outcome.result, steps };

  emit({ id: "fallback", message: fallbackNote(outcome.reason) });
  const result = await runDeterministicPipeline(input, emit);
  return { ...result, steps };
}
