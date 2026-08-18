import { test } from "node:test";
import assert from "node:assert/strict";
import { RedisCache } from "./redisCache.ts";
import type { RedisTransport } from "./redisRestClient.ts";

/** An in-memory stand-in for Upstash, so these tests never touch the network. */
function fakeTransport(): RedisTransport & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key) {
      return store.get(key) ?? null;
    },
    async set(key, value) {
      store.set(key, value);
    },
    async setnx(key, value) {
      if (store.has(key)) return false;
      store.set(key, value);
      return true;
    },
    async del(key) {
      store.delete(key);
    },
    // RedisCache never calls these — stubbed only to satisfy RedisTransport.
    async incr() {
      return 1;
    },
    async expire() {},
    async ttl() {
      return null;
    },
  };
}

test("returns a fresh value before expiry", async () => {
  let now = 1000;
  const cache = new RedisCache<string>(fakeTransport(), "ns", 500, () => now);
  await cache.set("a", "value");
  now += 100;
  assert.equal(await cache.get("a"), "value");
});

test("get() returns undefined once the TTL has elapsed", async () => {
  let now = 1000;
  const cache = new RedisCache<string>(fakeTransport(), "ns", 500, () => now);
  await cache.set("a", "value");
  now += 600;
  assert.equal(await cache.get("a"), undefined);
});

test("getStale() returns the value long after expiry", async () => {
  let now = 1000;
  const cache = new RedisCache<string>(fakeTransport(), "ns", 500, () => now);
  await cache.set("a", "value");
  now += 1_000_000;
  assert.equal(await cache.getStale("a"), "value");
});

test("getStale() returns undefined for a key that was never set", async () => {
  const cache = new RedisCache<string>(fakeTransport(), "ns", 500);
  assert.equal(await cache.getStale("missing"), undefined);
});

test("namespaces keys so two caches sharing a transport don't collide", async () => {
  const transport = fakeTransport();
  const search = new RedisCache<string>(transport, "search", 500);
  const inspection = new RedisCache<string>(transport, "inspection", 500);

  await search.set("a", "clinics");
  await inspection.set("a", "facts");

  assert.equal(await search.get("a"), "clinics");
  assert.equal(await inspection.get("a"), "facts");
});

test("get() fails open to undefined when the transport throws", async () => {
  const broken: RedisTransport = {
    get: async () => {
      throw new Error("network down");
    },
    set: async () => {
      throw new Error("network down");
    },
    setnx: async () => {
      throw new Error("network down");
    },
    del: async () => {
      throw new Error("network down");
    },
    incr: async () => {
      throw new Error("network down");
    },
    expire: async () => {
      throw new Error("network down");
    },
    ttl: async () => {
      throw new Error("network down");
    },
  };
  const cache = new RedisCache<string>(broken, "ns", 500);

  // Neither a failed read nor a failed write should throw out of the cache —
  // a Redis outage degrades to "not cached", the same as a cold cache.
  await assert.doesNotReject(() => cache.set("a", "value"));
  assert.equal(await cache.get("a"), undefined);
  assert.equal(await cache.getStale("a"), undefined);
});

test("get() fails open on a value that isn't valid JSON", async () => {
  const transport = fakeTransport();
  transport.store.set("ns:a", "not json");
  const cache = new RedisCache<string>(transport, "ns", 500);

  assert.equal(await cache.get("a"), undefined);
});
