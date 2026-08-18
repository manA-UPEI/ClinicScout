import { test } from "node:test";
import assert from "node:assert/strict";
import { RedisRateLimiter } from "./redisRateLimiter.ts";
import type { RedisTransport } from "../cache/redisRestClient.ts";

/** An in-memory stand-in for Upstash's INCR/EXPIRE/TTL, so these tests never touch the network. */
function fakeTransport(): RedisTransport {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();

  return {
    async get() {
      return null;
    },
    async set() {},
    async setnx() {
      return true;
    },
    async del(key) {
      counts.delete(key);
      ttls.delete(key);
    },
    async incr(key) {
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return next;
    },
    async expire(key, exSeconds) {
      ttls.set(key, exSeconds);
    },
    async ttl(key) {
      return ttls.get(key) ?? null;
    },
  };
}

test("allows attempts up to the limit within a window", async () => {
  const limiter = new RedisRateLimiter(fakeTransport(), "search", 3, 60);

  assert.equal((await limiter.consume("1.2.3.4")).allowed, true);
  assert.equal((await limiter.consume("1.2.3.4")).allowed, true);
  assert.equal((await limiter.consume("1.2.3.4")).allowed, true);
});

test("rejects the attempt that exceeds the limit, with a retry time from the key's TTL", async () => {
  const limiter = new RedisRateLimiter(fakeTransport(), "search", 2, 60);

  await limiter.consume("1.2.3.4");
  await limiter.consume("1.2.3.4");
  const blocked = await limiter.consume("1.2.3.4");

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 60_000);
});

test("tracks separate keys independently", async () => {
  const limiter = new RedisRateLimiter(fakeTransport(), "search", 1, 60);

  assert.equal((await limiter.consume("1.2.3.4")).allowed, true);
  assert.equal((await limiter.consume("5.6.7.8")).allowed, true);
  assert.equal((await limiter.consume("1.2.3.4")).allowed, false);
});

test("namespaces keys so two limiters sharing a transport don't collide", async () => {
  const transport = fakeTransport();
  const search = new RedisRateLimiter(transport, "search", 1, 60);
  const call = new RedisRateLimiter(transport, "call", 1, 60);

  assert.equal((await search.consume("1.2.3.4")).allowed, true);
  // Same caller, different route — the call limiter has never seen this key.
  assert.equal((await call.consume("1.2.3.4")).allowed, true);
});

test("falls back to the full window when TTL is unexpectedly missing", async () => {
  const transport = fakeTransport();
  // Simulate the EXPIRE-never-landed gap: force the count straight past the
  // limit without ever calling expire().
  await transport.incr("ratelimit:search:1.2.3.4");
  await transport.incr("ratelimit:search:1.2.3.4");

  const limiter = new RedisRateLimiter(transport, "search", 1, 60);
  const blocked = await limiter.consume("1.2.3.4");

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 60_000);
});
