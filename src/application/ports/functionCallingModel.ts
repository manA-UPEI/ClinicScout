import type { CallableOptions, ModelCallable } from "../../lib/gemini/functionCall.ts";

/** Builds a callable bound to one system instruction + tool declarations, for one agent run. */
export interface FunctionCallingModel {
  createCallable(options: CallableOptions): ModelCallable;
}
