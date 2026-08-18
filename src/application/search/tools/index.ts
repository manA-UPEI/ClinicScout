import { AgentError } from "../../../domain/entities/errors.ts";
import type { FunctionDeclaration } from "../../../infrastructure/llm/geminiFunctionCallClient.ts";
import { logger } from "../../../infrastructure/logging/logger.ts";
import type { RunState } from "../agentState.ts";
import { geocodeTool } from "./geocodeTool.ts";
import { searchTool } from "./searchTool.ts";
import { inspectTool } from "./inspectTool.ts";
import { rankTool } from "./rankTool.ts";
import { detailsTool } from "./detailsTool.ts";
import { finalizeTool } from "./finalizeTool.ts";
import { fail } from "./shared.ts";
import type { AgentTool, ToolOutcome } from "./shared.ts";

export type { AgentTool, ToolExecutor, ToolOutcome } from "./shared.ts";

export const AGENT_TOOLS: AgentTool[] = [
  geocodeTool,
  searchTool,
  inspectTool,
  rankTool,
  detailsTool,
  finalizeTool,
];

export const TOOL_DECLARATIONS: FunctionDeclaration[] = AGENT_TOOLS.map(
  (t) => t.declaration
);

const BY_NAME = new Map(AGENT_TOOLS.map((t) => [t.declaration.name, t]));

/**
 * Runs one model-requested tool call. An AgentError is the user's problem to
 * fix (bad location, directory unreachable) and propagates; anything else is
 * handed back to the model as a tool error so it can adapt.
 */
export async function executeTool(
  state: RunState,
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return fail(
      `No such tool "${name}". Available: ${[...BY_NAME.keys()].join(", ")}.`
    );
  }

  try {
    return await tool.execute(state, args);
  } catch (e) {
    if (e instanceof AgentError) throw e;
    logger.error({ tool: name, err: e }, "Tool failed");
    return fail(
      `${name} failed: ${e instanceof Error ? e.message : "unknown error"}. Try a different approach.`
    );
  }
}
