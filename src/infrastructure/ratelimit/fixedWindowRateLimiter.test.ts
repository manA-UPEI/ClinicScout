import { test } from "node:test";
import assert from "node:assert/strict";
import { FixedWindowRateLimiter } from "./fixedWindowRateLimiter.ts";

function fakeClock(startAt = 0) {
  let t = startAt;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("allows attempts up to the limit within a window", async () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(3, 1000, clock.now);

  assert.equal((await limiter.consume("a")).allowed, true);
  assert.equal((await limiter.consume("a")).allowed, true);
  assert.equal((await limiter.consume("a")).allowed, true);
});

test("rejects the attempt that exceeds the limit, with a retry time", async () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(2, 1000, clock.now);

  await limiter.consume("a");
  await limiter.consume("a");
  const blocked = await limiter.consume("a");

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 1000);
});

test("resets once the window has fully elapsed", async () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(1, 1000, clock.now);

  await limiter.consume("a");
  assert.equal((await limiter.consume("a")).allowed, false);

  clock.advance(1000);
  assert.equal((await limiter.consume("a")).allowed, true);
});

test("tracks separate keys independently", async () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(1, 1000, clock.now);

  assert.equal((await limiter.consume("a")).allowed, true);
  assert.equal((await limiter.consume("b")).allowed, true);
  assert.equal((await limiter.consume("a")).allowed, false);
});

test("retryAfterMs counts down as the window elapses", async () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(1, 1000, clock.now);

  await limiter.consume("a");
  clock.advance(400);
  const blocked = await limiter.consume("a");

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 600);
});

// A key drawn from unauthenticated input (x-forwarded-for) is spoofable —
// see clientIp.ts — so an attacker can send a fresh one on every request.
// Without a cap, every such key lives on forever, since nothing evicts an
// entry once its window has passed; only a repeat hit on the same key does.
// These pin the resulting memory bound and the generation-rotation mechanics
// that produce it (see the class doc comment for why it isn't a plain
// single-map eviction).
test("never tracks more than ~2x maxKeys entries combined, however many distinct keys arrive", async () => {
  const clock = fakeClock();
  const maxKeys = 100;
  const limiter = new FixedWindowRateLimiter(5, 1000, clock.now, maxKeys);

  for (let i = 0; i < 10_000; i++) {
    await limiter.consume(`spoofed-${i}`);
  }

  const current = limiter["current"] as Map<string, unknown>;
  const previous = limiter["previous"] as Map<string, unknown>;
  assert.ok(current.size <= maxKeys, `current grew to ${current.size}`);
  assert.ok(previous.size <= maxKeys, `previous grew to ${previous.size}`);
  assert.ok(current.size + previous.size > 0);
});

test("a key already tracked can always refresh into a new window, even exactly at capacity", async () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(1, 1000, clock.now, 3);

  await limiter.consume("a");
  await limiter.consume("b");
  await limiter.consume("c");
  const current = limiter["current"] as Map<string, unknown>;
  assert.equal(current.size, 3, "at capacity, no rotation needed yet");

  // "a"'s window has now passed. Resetting it reuses its existing slot in
  // `current` rather than counting as a new key, so it must never trigger a
  // rotation that would drop b or c early.
  clock.advance(1000);
  assert.equal((await limiter.consume("a")).allowed, true);
  assert.equal(current.size, 3);
  assert.ok(current.has("b"));
  assert.ok(current.has("c"));
});

test("a genuinely new key past capacity rotates the whole generation rather than evicting one entry", async () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(1, 1000, clock.now, 3);

  await limiter.consume("a");
  await limiter.consume("b");
  await limiter.consume("c");

  await limiter.consume("d");

  // The full a/b/c generation moves to `previous` intact — still readable,
  // not individually evicted — while `d` starts a fresh `current`.
  const current1 = limiter["current"] as Map<string, unknown>;
  const previous1 = limiter["previous"] as Map<string, unknown>;
  assert.deepEqual([...current1.keys()], ["d"]);
  assert.deepEqual(new Set(previous1.keys()), new Set(["a", "b", "c"]));
  assert.equal((await limiter.consume("a")).allowed, false, "a's window is still enforced via `previous`");

  // Only once `current` fills again (to "d", "e", "f") and a further new key
  // ("g") triggers a second rotation does the original a/b/c generation
  // actually disappear.
  await limiter.consume("e");
  await limiter.consume("f");
  await limiter.consume("g");
  const previous2 = limiter["previous"] as Map<string, unknown>;
  assert.equal(previous2.has("a"), false);
});
