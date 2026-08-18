export interface RedisRestConfig {
  url: string;
  token: string;
}

/**
 * The Redis commands RedisCache and RedisCallSessionStore need. GET/SET
 * cover the cache; SETNX and DEL are what let the call-session store claim a
 * clinic atomically and release the claim when a call ends.
 */
export interface RedisTransport {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, exSeconds: number): Promise<void>;
  /** Sets only if the key doesn't already exist. Returns whether the set happened — the atomic primitive an exclusive claim needs instead of a separate check-then-act that could race. */
  setnx(key: string, value: string, exSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
}

const TIMEOUT_MS = 5000;

/**
 * Sends one command as a JSON array to Upstash's REST endpoint — the form
 * Upstash documents as its general-purpose command API, and the one that
 * doesn't need URL-encoding a value that might contain any character once
 * it's JSON.
 *
 * Hand-rolled with fetch rather than the @upstash/redis SDK, matching how
 * infrastructure/llm/geminiHttpClient.ts talks to Gemini directly: one thin
 * transport with its own timeout, no dependency pulled in for two commands.
 */
async function runCommand(
  config: RedisRestConfig,
  command: (string | number)[]
): Promise<unknown> {
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify(command),
  });

  const data = (await response.json().catch(() => null)) as
    | { result: unknown; error?: string }
    | null;

  if (!response.ok || data?.error) {
    throw new Error(data?.error ?? `Upstash Redis returned ${response.status}`);
  }

  return data?.result ?? null;
}

/** The real transport, talking to Upstash over its REST API. */
export function createRedisRestTransport(config: RedisRestConfig): RedisTransport {
  return {
    async get(key) {
      const result = await runCommand(config, ["GET", key]);
      return typeof result === "string" ? result : null;
    },
    async set(key, value, exSeconds) {
      await runCommand(config, ["SET", key, value, "EX", exSeconds]);
    },
    async setnx(key, value, exSeconds) {
      // Redis returns "OK" when the SET happened, null when NX blocked it
      // because the key already existed.
      const result = await runCommand(config, ["SET", key, value, "NX", "EX", exSeconds]);
      return result === "OK";
    },
    async del(key) {
      await runCommand(config, ["DEL", key]);
    },
  };
}
