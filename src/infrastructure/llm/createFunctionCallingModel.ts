import { fixturesEnabled } from "../config/fixtureMode.ts";
import { createFixtureCallable } from "../fixtures/fixtureFunctionCallingModel.ts";
import { createGeminiCallable } from "./geminiFunctionCallClient.ts";
import type { CallableOptions, ModelCallable } from "./geminiFunctionCallClient.ts";

export type { CallableOptions, ModelCallable };

/** The scripted fixture agent when USE_FIXTURES is set, else the live Gemini function-calling client. */
export function createCallable(options: CallableOptions): ModelCallable {
  return fixturesEnabled()
    ? createFixtureCallable(options)
    : createGeminiCallable(options);
}
