export interface RedisRestConfig {
  url: string;
  token: string;
}

/**
 * The Redis commands RedisCache, RedisCallSessionStore, and RedisRateLimiter
 * need. GET/SET cover the cache; SETNX and DEL are what let the call-session
 * store claim a clinic atomically and release the claim when a call ends;
 * INCR/EXPIRE/TTL are what let the rate limiter keep one shared count across
 * every serverless instance instead of one count per instance, and EVAL is
 * what lets it do so atomically.
 */
export interface RedisTransport {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, exSeconds: number): Promise<void>;
  /** Sets only if the key doesn't already exist. Returns whether the set happened — the atomic primitive an exclusive claim needs instead of a separate check-then-act that could race. */
  setnx(key: string, value: string, exSeconds: number): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Atomically increments (creating the key at 1 if it didn't exist) and returns the new count. */
  incr(key: string): Promise<number>;
  expire(key: string, exSeconds: number): Promise<void>;
  /** Seconds remaining before the key expires, or null if it has no TTL or doesn't exist. */
  ttl(key: string): Promise<number | null>;
  /**
   * Runs a Lua script server-side. Redis executes a script atomically, so
   * this is what lets a read-modify-write sequence — the rate limiter's
   * INCR-then-EXPIRE — happen with nothing interleaved between the steps,
   * and in one round trip rather than three.
   */
  eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown>;
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
    async incr(key) {
      const result = await runCommand(config, ["INCR", key]);
      return typeof result === "number" ? result : Number(result);
    },
    async expire(key, exSeconds) {
      await runCommand(config, ["EXPIRE", key, exSeconds]);
    },
    async ttl(key) {
      const result = await runCommand(config, ["TTL", key]);
      const seconds = typeof result === "number" ? result : Number(result);
      // Redis returns -2 for "no such key" and -1 for "no expiry set" —
      // neither is a meaningful remaining time.
      return seconds >= 0 ? seconds : null;
    },
    async eval(script, keys, args) {
      // EVAL's wire form is the script, then how many of the trailing
      // arguments are keys, then keys followed by plain args. Redis needs the
      // count to tell the two apart; it cannot infer the split.
      return runCommand(config, ["EVAL", script, keys.length, ...keys, ...args]);
    },
  };
}
