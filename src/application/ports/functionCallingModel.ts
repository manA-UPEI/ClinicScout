import type { CallableOptions, ModelCallable } from "../../infrastructure/llm/geminiFunctionCallClient.ts";

/** Builds a callable bound to one system instruction + tool declarations, for one agent run. */
export interface FunctionCallingModel {
  createCallable(options: CallableOptions): ModelCallable;
}
