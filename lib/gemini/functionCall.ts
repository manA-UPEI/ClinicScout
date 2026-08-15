import type { ResponseSchema } from "../tools/gemini.ts";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
// Same pin as lib/tools/gemini.ts, and for the same reason: an alias resolved
// to a preview model with a much tighter free-tier quota and caused a live 429
// storm. The orchestrator loop makes several calls per run, so it is even more
// exposed to that than the single-shot extractor is.
const DEFAULT_MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 20_000;

/** A tool the model may call, in the shape Gemini's functionDeclarations expects. */
export interface FunctionDeclaration {
  name: string;
  description: string;
  parameters: ResponseSchema;
}

export interface ModelFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/** One entry in the running transcript sent back to the model each turn. */
export interface Content {
  role: "user" | "model";
  parts: Part[];
}

/**
 * `thoughtSignature` is an opaque token the model attaches to its own parts.
 * Gemini 3.x rejects a transcript that replays a functionCall without it, so it
 * is carried through untouched rather than interpreted.
 */
export interface PartMeta {
  thoughtSignature?: string;
}

export type Part =
  | ({ text: string } & PartMeta)
  | ({ functionCall: ModelFunctionCall } & PartMeta)
  | { functionResponse: { name: string; response: Record<string, unknown> } };

/**
 * What the model did with a turn. `failed` is distinct from `text` so the loop
 * can tell "the model finished talking" from "we could not reach the model" —
 * only the latter should trigger the deterministic fallback.
 *
 * `parts` is the model's reply verbatim. The loop echoes it back into the
 * transcript rather than rebuilding it from `calls`, which preserves
 * thought signatures and anything else opaque the API adds later.
 */
export type ModelTurn =
  | { kind: "calls"; calls: ModelFunctionCall[]; parts?: Part[] }
  | { kind: "text"; text: string }
  | { kind: "failed"; reason: string };

/**
 * The loop depends on this type rather than on the network client, so tests can
 * drive a whole agent run from a scripted transcript with no API key.
 */
export type ModelCallable = (contents: Content[]) => Promise<ModelTurn>;

interface GeminiResponse {
  candidates?: { content?: { parts?: Part[] } }[];
  error?: { message?: string };
}

function isFunctionCall(part: Part): part is { functionCall: ModelFunctionCall } {
  return "functionCall" in part && Boolean(part.functionCall?.name);
}

function isText(part: Part): part is { text: string } {
  return "text" in part && typeof part.text === "string";
}

export interface CallableOptions {
  systemInstruction: string;
  functionDeclarations: FunctionDeclaration[];
}

/**
 * Builds the live Gemini caller. Deliberately does not set a thinkingConfig:
 * the default is known-good, and the loop's wall-clock budget is enforced by
 * the caller either way. If tool selection proves too slow under the budget,
 * capping the thinking budget here is the first knob to reach for.
 */
export function createGeminiCallable(options: CallableOptions): ModelCallable {
  return async function callModel(contents: Content[]): Promise<ModelTurn> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return { kind: "failed", reason: "no_api_key" };
    const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

    let response: Response;
    try {
      response = await fetch(`${API_BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: options.systemInstruction }] },
          contents,
          tools: [{ functionDeclarations: options.functionDeclarations }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          generationConfig: { temperature: 0 },
        }),
      });
    } catch {
      return { kind: "failed", reason: "network" };
    }

    const data = (await response.json().catch(() => null)) as GeminiResponse | null;

    if (!response.ok) {
      console.error(
        `Gemini ${model} returned ${response.status}: ${data?.error?.message ?? "unknown error"}` +
          (response.status === 404
            ? " — set GEMINI_MODEL to a model your key can access."
            : "")
      );
      // Surfaced distinctly because the free tier's 429 is the failure this app
      // has actually hit in a live demo, and it is the one worth naming in logs.
      return { kind: "failed", reason: response.status === 429 ? "quota" : "http_error" };
    }

    const parts = data?.candidates?.[0]?.content?.parts ?? [];

    // Gemini 2.5 can emit several functionCall parts in one turn. Executing all
    // of them and replying with all their results in a single turn is the
    // protocol-correct handling — replying to only the first would leave the
    // rest unanswered and the transcript malformed.
    const calls = parts.filter(isFunctionCall).map((p) => p.functionCall);
    if (calls.length > 0) return { kind: "calls", calls, parts };

    const text = parts
      .filter(isText)
      .map((p) => p.text)
      .join("")
      .trim();
    if (text) return { kind: "text", text };

    return { kind: "failed", reason: "empty_response" };
  };
}
