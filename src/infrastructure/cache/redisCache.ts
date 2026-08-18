import type { Cache } from "./cache.ts";
import type { RedisTransport } from "./redisRestClient.ts";
import { logger } from "../logging/logger.ts";

interface StoredEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * A Cache<T> backed by Redis instead of process memory, so an entry — and
 * the correctness guarantees that depend on it, like not re-inspecting a
 * clinic site already verified minutes ago — holds across serverless
 * instances and cold starts, unlike TtlCache's Map.
 *
 * Preserves TtlCache's "serve stale over nothing" behavior: an entry carries
 * its own `expiresAt` and stays readable past it via getStale, rather than
 * relying on Redis's own TTL to expire it — that would delete the fallback
 * data along with its freshness. Redis's TTL is set far longer than the
 * cache's own, purely so an abandoned key is eventually garbage collected
 * instead of living forever.
 *
 * Fails open on any transport error: get/getStale resolve to undefined and
 * set logs and gives up, rather than throwing. A cache is a safety net: a
 * Redis blip should fall through to a live fetch — exactly what a cold
 * cache already does — not turn into a hard failure for the request.
 *
 * Takes a RedisTransport rather than talking to Upstash directly, so it can
 * be tested against an in-memory fake instead of the network — the same
 * injectable-dependency shape as TtlCache's `now` and the agent loop's
 * `callModel`/`runTool`.
 */
export class RedisCache<T> implements Cache<T> {
  private readonly transport: RedisTransport;
  private readonly namespace: string;
  private readonly ttlMs: number;
  private readonly now: () => number;

  // Written out instead of constructor parameter properties: Node's
  // strip-only TypeScript execution (the raw `node --test` runner) can erase
  // type annotations but not this shorthand, since it also declares fields —
  // the same reason TtlCache and AgentError do the same.
  constructor(
    transport: RedisTransport,
    namespace: string,
    ttlMs: number,
    now: () => number = Date.now
  ) {
    this.transport = transport;
    this.namespace = namespace;
    this.ttlMs = ttlMs;
    this.now = now;
  }

  async get(key: string): Promise<T | undefined> {
    const entry = await this.read(key);
    if (!entry || this.now() > entry.expiresAt) return undefined;
    return entry.value;
  }

  async getStale(key: string): Promise<T | undefined> {
    return (await this.read(key))?.value;
  }

  async set(key: string, value: T): Promise<void> {
    const entry: StoredEntry<T> = { value, expiresAt: this.now() + this.ttlMs };
    // Kept well past its own freshness window so a still-useful stale
    // fallback isn't garbage collected out from under getStale().
    const retainSeconds = Math.ceil((this.ttlMs * 7) / 1000);

    try {
      await this.transport.set(this.fullKey(key), JSON.stringify(entry), retainSeconds);
    } catch (e) {
      logger.error({ key: this.fullKey(key), err: e }, "RedisCache: failed to write");
    }
  }

  private async read(key: string): Promise<StoredEntry<T> | undefined> {
    try {
      const raw = await this.transport.get(this.fullKey(key));
      if (!raw) return undefined;
      return JSON.parse(raw) as StoredEntry<T>;
    } catch (e) {
      logger.error({ key: this.fullKey(key), err: e }, "RedisCache: failed to read");
      return undefined;
    }
  }

  private fullKey(key: string): string {
    return `${this.namespace}:${key}`;
  }
}
