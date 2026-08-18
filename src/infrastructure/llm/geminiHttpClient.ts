import type { ConfigProvider } from "../../application/ports/configProvider.ts";
import { logger } from "../logging/logger.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiHttpOutcome =
  | { ok: true; data: unknown }
  | { ok: false; reason: "no_api_key" | "network" | "quota" | "http_error" };

/**
 * Shared POST-to-generateContent transport: builds the request, applies the
 * timeout, and classifies a non-2xx response (429 as "quota", separately from
 * every other status, since the free tier's 429 is the failure this app has
 * actually hit in a live demo and is worth naming distinctly in logs).
 *
 * Used by both Gemini adapters (single-shot JSON extraction and
 * function-calling) so there is exactly one place that reads an API key,
 * builds this URL, and parses an error response — previously each adapter
 * hand-rolled its own copy of this logic.
 */
export async function postGenerateContent(
  config: ConfigProvider,
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<GeminiHttpOutcome> {
  const apiKey = config.geminiApiKey();
  if (!apiKey) return { ok: false, reason: "no_api_key" };
  const model = config.geminiModel();

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, reason: "network" };
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      (data as { error?: { message?: string } } | null)?.error?.message ?? "unknown error";
    logger.error(
      { model, status: response.status, message },
      response.status === 404
        ? "Gemini request failed — set GEMINI_MODEL to a model your key can access"
        : "Gemini request failed"
    );
    return { ok: false, reason: response.status === 429 ? "quota" : "http_error" };
  }

  return { ok: true, data };
}
