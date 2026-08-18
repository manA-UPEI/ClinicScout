import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, TtlCache } from "./ttlCache.ts";

test("returns a fresh value before expiry", async () => {
  let now = 1000;
  const cache = new TtlCache<string>(500, () => now);
  await cache.set("a", "value");
  now += 100;
  assert.equal(await cache.get("a"), "value");
});

test("get() returns undefined once the TTL has elapsed", async () => {
  let now = 1000;
  const cache = new TtlCache<string>(500, () => now);
  await cache.set("a", "value");
  now += 600;
  assert.equal(await cache.get("a"), undefined);
});

test("get() returns undefined for a key that was never set", async () => {
  const cache = new TtlCache<string>(500);
  assert.equal(await cache.get("missing"), undefined);
});

test("getStale() returns the value even long after expiry", async () => {
  // This is the whole point of the cache: when the upstream service is down,
  // an old answer must still be recoverable, not just discarded on expiry.
  let now = 1000;
  const cache = new TtlCache<string>(500, () => now);
  await cache.set("a", "value");
  now += 1_000_000;
  assert.equal(await cache.getStale("a"), "value");
});

test("getStale() returns undefined for a key that was never set", async () => {
  const cache = new TtlCache<string>(500);
  assert.equal(await cache.getStale("missing"), undefined);
});

test("keys are independent", async () => {
  const cache = new TtlCache<string>(500);
  await cache.set("a", "one");
  await cache.set("b", "two");
  assert.equal(await cache.get("a"), "one");
  assert.equal(await cache.get("b"), "two");
});

test("re-setting a key refreshes its expiry", async () => {
  let now = 1000;
  const cache = new TtlCache<string>(500, () => now);
  await cache.set("a", "first");
  now += 400;
  await cache.set("a", "second");
  now += 400; // 400ms past the second set, but only 800ms past the first
  assert.equal(await cache.get("a"), "second");
});

test("cacheKey collapses nearby coordinates and matching radii to the same key", () => {
  const a = cacheKey({ lat: 45.4215, lon: -75.6997 }, 5);
  const b = cacheKey({ lat: 45.4219, lon: -75.6993 }, 5.0);
  assert.equal(a, b);
});

test("cacheKey distinguishes different radii for the same point", () => {
  const a = cacheKey({ lat: 45.4215, lon: -75.6997 }, 5);
  const b = cacheKey({ lat: 45.4215, lon: -75.6997 }, 10);
  assert.notEqual(a, b);
});

test("cacheKey distinguishes clearly different locations", () => {
  const ottawa = cacheKey({ lat: 45.4215, lon: -75.6997 }, 5);
  const toronto = cacheKey({ lat: 43.6532, lon: -79.3832 }, 5);
  assert.notEqual(ottawa, toronto);
});
