import type { ResponseSchema } from "../../infrastructure/llm/geminiJsonClient.ts";

/** One-shot "extract structured JSON from a prompt" model call. */
export interface JsonExtractionModel {
  /** Returns null on any failure — a model outage degrades a field to Unknown, never blocks the run. */
  generateJson<T>(prompt: string, schema: ResponseSchema): Promise<T | null>;
  isConfigured(): boolean;
}
