import type { ConfigProvider } from "../../application/ports/configProvider.ts";

// Pinned rather than an alias: "gemini-flash-latest" resolved to a preview
// model with a much tighter free-tier quota than this one, and caused a live
// 429 storm during this app's own testing. A demo that fails under load is
// worse than a pinned id that eventually needs a manual bump. Override via
// GEMINI_MODEL if you have a different model your key can access.
const DEFAULT_MODEL = "gemini-2.5-flash";

/**
 * The one place GEMINI_API_KEY / GEMINI_MODEL are read from process.env.
 * Both Gemini adapters (single-shot JSON extraction and function-calling)
 * depend on this instead of reading process.env themselves, which is what
 * used to make them two independently-drifting copies of the same lookup.
 */
export function createEnvConfigProvider(): ConfigProvider {
  return {
    geminiApiKey: () => process.env.GEMINI_API_KEY ?? null,
    geminiModel: () => process.env.GEMINI_MODEL || DEFAULT_MODEL,
    isGeminiConfigured() {
      return this.geminiApiKey() !== null;
    },
  };
}
