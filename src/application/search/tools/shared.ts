import type { AgentStep } from "../../../domain/entities/agentRun.ts";
import type { FunctionDeclaration } from "../../../infrastructure/llm/geminiFunctionCallClient.ts";
import type { RunState } from "../agentState.ts";

export interface ToolOutcome {
  /** Sent back to the model as the functionResponse payload. */
  response: Record<string, unknown>;
  /** Appended to the transparency log and streamed to the UI. */
  step?: AgentStep;
  /** Set by finalize_recommendation to end the loop. */
  done?: boolean;
}

export type ToolExecutor = (
  state: RunState,
  args: Record<string, unknown>
) => Promise<ToolOutcome>;

export interface AgentTool {
  declaration: FunctionDeclaration;
  execute: ToolExecutor;
}

/** Shorthand for a tool rejecting its arguments — becomes a functionResponse error, not a thrown exception. */
export function fail(message: string): ToolOutcome {
  return { response: { error: message } };
}

/** Coerces a model-supplied value into a deduped, capped list of string ids. */
export function asIdList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const ids = value.filter((v): v is string => typeof v === "string");
  return [...new Set(ids)].slice(0, cap);
}
