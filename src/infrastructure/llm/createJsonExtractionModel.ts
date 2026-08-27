import { fixturesEnabled } from "../config/fixtureMode.ts";
import {
  fixtureGeminiConfigured,
  fixtureGenerateJson,
} from "../fixtures/fixtureJsonExtractionModel.ts";
import {
  generateJson as geminiGenerateJson,
  geminiConfigured as realGeminiConfigured,
} from "./geminiJsonClient.ts";
import type { ResponseSchema } from "./geminiJsonClient.ts";

export type { ResponseSchema };

/** Canned extractions when USE_FIXTURES is set, else the real single-shot Gemini call. */
export function generateJson<T>(
  prompt: string,
  schema: ResponseSchema
): Promise<T | null> {
  return fixturesEnabled()
    ? fixtureGenerateJson<T>(prompt, schema)
    : geminiGenerateJson<T>(prompt, schema);
}

/**
 * Fixture mode reports itself as configured even with no GEMINI_API_KEY.
 *
 * Without this, a fixture run with no key set would take the no-key
 * deterministic fallback and never touch the agent loop at all — which is
 * precisely the path most worth being able to run offline.
 */
export function geminiConfigured(): boolean {
  return fixturesEnabled() ? fixtureGeminiConfigured() : realGeminiConfigured();
}
