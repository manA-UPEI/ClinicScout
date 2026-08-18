import type { JsonExtractionModel } from "../../application/ports/jsonExtractionModel.ts";
import type { ConfigProvider } from "../../application/ports/configProvider.ts";
import { createEnvConfigProvider } from "../config/env.ts";
import { postGenerateContent } from "./geminiHttpClient.ts";

const TIMEOUT_MS = 20_000;

/** OpenAPI-subset schema, the shape Gemini's responseSchema accepts. */
export interface ResponseSchema {
  type: "OBJECT" | "ARRAY" | "STRING" | "BOOLEAN" | "NUMBER" | "INTEGER";
  properties?: Record<string, ResponseSchema>;
  items?: ResponseSchema;
  required?: string[];
  nullable?: boolean;
  enum?: string[];
  description?: string;
}

interface GeminiJsonResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
}

/**
 * The single-shot structured-JSON extraction adapter used for website
 * inspection and call-finding extraction. Website inspection is an
 * enrichment pass — if the model is unreachable the run continues with
 * fields left unknown, which is the honest outcome rather than a blocked
 * search, so `generateJson` returns null on any failure rather than throwing.
 */
export function createGeminiJsonClient(
  config: ConfigProvider = createEnvConfigProvider()
): JsonExtractionModel {
  return {
    isConfigured: () => config.isGeminiConfigured(),

    async generateJson<T>(prompt: string, schema: ResponseSchema): Promise<T | null> {
      const outcome = await postGenerateContent(
        config,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: schema,
          },
        },
        TIMEOUT_MS
      );
      if (!outcome.ok) return null;

      const text = (outcome.data as GeminiJsonResponse)?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) return null;

      try {
        return JSON.parse(text) as T;
      } catch {
        return null;
      }
    },
  };
}

// A module-level default client, so existing call sites can keep calling
// plain functions rather than threading a JsonExtractionModel through every
// layer immediately — later commits migrate them to explicit injection as
// each subsystem is restructured.
const defaultClient = createGeminiJsonClient();

export function geminiConfigured(): boolean {
  return defaultClient.isConfigured();
}

export function generateJson<T>(prompt: string, schema: ResponseSchema): Promise<T | null> {
  return defaultClient.generateJson<T>(prompt, schema);
}
