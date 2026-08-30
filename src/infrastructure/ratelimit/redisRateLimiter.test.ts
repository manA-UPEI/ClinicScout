import { test } from "node:test";
import assert from "node:assert/strict";
import { RedisRateLimiter } from "./redisRateLimiter.ts";
import type { RedisTransport } from "../cache/redisRestClient.ts";

interface FakeTransport extends RedisTransport {
  /** How many script executions the limiter has asked for — one per consume() is the contract. */
  evalCount: number;
}

/**
 * An in-memory stand-in for Upstash, implementing EVAL with the same
 * semantics the real Lua script has: increment, set the expiry only on the
 * first hit, report count and remaining TTL together.
 */
function fakeTransport(): FakeTransport {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();

  return {
    evalCount: 0,
    async get() {
      return null;
    },
    async set() {},
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
    async eval(_script, keys, args) {
      this.evalCount++;
      const key = keys[0];
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (count === 1) ttls.set(key, Number(args[0]));
      // Redis reports -1 when a key exists with no expiry set.
      return [count, ttls.get(key) ?? -1];
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

test("reports the remaining allowance alongside the verdict", async () => {
  const limiter = new RedisRateLimiter(fakeTransport(), "search", 3, 60);

  assert.equal((await limiter.consume("1.2.3.4")).remaining, 2);
  assert.equal((await limiter.consume("1.2.3.4")).remaining, 1);
  assert.equal((await limiter.consume("1.2.3.4")).remaining, 0);
  assert.equal((await limiter.consume("1.2.3.4")).remaining, 0);
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

// The window must reset. Setting the expiry on every hit instead of only the
// first would push it out forever and the bucket would never let anyone
// through again.
test("sets the expiry once per window, not on every hit", async () => {
  const transport = fakeTransport();
  const limiter = new RedisRateLimiter(transport, "search", 5, 60);

  await limiter.consume("1.2.3.4");
  const afterFirst = await transport.ttl("ratelimit:search:1.2.3.4");
  await limiter.consume("1.2.3.4");
  await limiter.consume("1.2.3.4");

  assert.equal(await transport.ttl("ratelimit:search:1.2.3.4"), afterFirst);
});

// One script execution per consume, not INCR + EXPIRE + TTL as three separate
// commands. That is what makes the sequence atomic — and it is invisible in
// the result, so only a test keeps it from regressing.
test("takes exactly one round trip per attempt", async () => {
  const transport = fakeTransport();
  const limiter = new RedisRateLimiter(transport, "search", 1, 60);

  await limiter.consume("1.2.3.4");
  await limiter.consume("1.2.3.4");

  assert.equal(transport.evalCount, 2);
});

test("falls back to the full window when the key has no expiry", async () => {
  const transport = fakeTransport();
  // Simulate a key left without a TTL: increment past the limit directly, so
  // the script's `count == 1` branch never runs and no expiry is ever set.
  await transport.incr("ratelimit:search:1.2.3.4");
  await transport.incr("ratelimit:search:1.2.3.4");

  const limiter = new RedisRateLimiter(transport, "search", 1, 60);
  const blocked = await limiter.consume("1.2.3.4");

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 60_000);
});

test("copes with a transport that renders integers as strings", async () => {
  const stringy: RedisTransport = {
    ...fakeTransport(),
    async eval() {
      return ["3", "45"];
    },
  };
  const limiter = new RedisRateLimiter(stringy, "search", 2, 60);

  const blocked = await limiter.consume("1.2.3.4");

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 45_000);
});

test("raises rather than guessing when the script returns something unexpected", async () => {
  const broken: RedisTransport = {
    ...fakeTransport(),
    async eval() {
      return null;
    },
  };
  const limiter = new RedisRateLimiter(broken, "search", 2, 60);

  await assert.rejects(() => limiter.consume("1.2.3.4"), /unexpected shape/);
});
