import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, TtlCache } from "../infrastructure/cache/ttlCache.ts";

test("returns a fresh value before expiry", () => {
  let now = 1000;
  const cache = new TtlCache<string>(500, () => now);
  cache.set("a", "value");
  now += 100;
  assert.equal(cache.get("a"), "value");
});

test("get() returns undefined once the TTL has elapsed", () => {
  let now = 1000;
  const cache = new TtlCache<string>(500, () => now);
  cache.set("a", "value");
  now += 600;
  assert.equal(cache.get("a"), undefined);
});

test("get() returns undefined for a key that was never set", () => {
  const cache = new TtlCache<string>(500);
  assert.equal(cache.get("missing"), undefined);
});

test("getStale() returns the value even long after expiry", () => {
  // This is the whole point of the cache: when the upstream service is down,
  // an old answer must still be recoverable, not just discarded on expiry.
  let now = 1000;
  const cache = new TtlCache<string>(500, () => now);
  cache.set("a", "value");
  now += 1_000_000;
  assert.equal(cache.getStale("a"), "value");
});

test("getStale() returns undefined for a key that was never set", () => {
  const cache = new TtlCache<string>(500);
  assert.equal(cache.getStale("missing"), undefined);
});

test("keys are independent", () => {
  const cache = new TtlCache<string>(500);
  cache.set("a", "one");
  cache.set("b", "two");
  assert.equal(cache.get("a"), "one");
  assert.equal(cache.get("b"), "two");
});

test("re-setting a key refreshes its expiry", () => {
  let now = 1000;
  const cache = new TtlCache<string>(500, () => now);
  cache.set("a", "first");
  now += 400;
  cache.set("a", "second");
  now += 400; // 400ms past the second set, but only 800ms past the first
  assert.equal(cache.get("a"), "second");
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
