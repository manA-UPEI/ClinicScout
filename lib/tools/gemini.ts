const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Pinned rather than an alias: "gemini-flash-latest" resolved to a preview
// model with a much tighter free-tier quota than this one, and caused a live
// 429 storm during this app's own testing. A demo that fails under load is
// worse than a pinned id that eventually needs a manual bump. Override via
// GEMINI_MODEL if you have a different model your key can access.
const DEFAULT_MODEL = "gemini-2.5-flash";
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

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string };
}

/**
 * Returns null on any failure. Website inspection is an enrichment pass — if
 * the model is unreachable the run continues with fields left unknown, which
 * is the honest outcome rather than a blocked search.
 */
export async function generateJson<T>(
  prompt: string,
  schema: ResponseSchema
): Promise<T | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    });
  } catch {
    return null;
  }

  const data = (await response.json().catch(() => null)) as GeminiResponse | null;

  if (!response.ok) {
    console.error(
      `Gemini ${model} returned ${response.status}: ${data?.error?.message ?? "unknown error"}` +
        (response.status === 404 ? " — set GEMINI_MODEL to a model your key can access." : "")
    );
    return null;
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
