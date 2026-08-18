import { test } from "node:test";
import assert from "node:assert/strict";
import { FixedWindowRateLimiter } from "./fixedWindowRateLimiter.ts";

function fakeClock(startAt = 0) {
  let t = startAt;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("allows attempts up to the limit within a window", () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(3, 1000, clock.now);

  assert.equal(limiter.consume("a").allowed, true);
  assert.equal(limiter.consume("a").allowed, true);
  assert.equal(limiter.consume("a").allowed, true);
});

test("rejects the attempt that exceeds the limit, with a retry time", () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(2, 1000, clock.now);

  limiter.consume("a");
  limiter.consume("a");
  const blocked = limiter.consume("a");

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 1000);
});

test("resets once the window has fully elapsed", () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(1, 1000, clock.now);

  limiter.consume("a");
  assert.equal(limiter.consume("a").allowed, false);

  clock.advance(1000);
  assert.equal(limiter.consume("a").allowed, true);
});

test("tracks separate keys independently", () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(1, 1000, clock.now);

  assert.equal(limiter.consume("a").allowed, true);
  assert.equal(limiter.consume("b").allowed, true);
  assert.equal(limiter.consume("a").allowed, false);
});

test("retryAfterMs counts down as the window elapses", () => {
  const clock = fakeClock();
  const limiter = new FixedWindowRateLimiter(1, 1000, clock.now);

  limiter.consume("a");
  clock.advance(400);
  const blocked = limiter.consume("a");

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, 600);
});
