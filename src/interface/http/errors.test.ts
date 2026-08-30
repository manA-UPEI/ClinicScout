import { test } from "node:test";
import assert from "node:assert/strict";
import { badRequest, serviceAtCapacity, tooManyRequests } from "./errors.ts";

const GATE_HEADERS = { "RateLimit-Limit": "5", "RateLimit-Remaining": "3" };

// The reason these headers belong on a 400 at all: the rate-limit gate runs
// before body parsing, so a request rejected for a malformed body has already
// spent one of the caller's tokens. Without this the count moved and nothing
// said so.
test("a rejected body still reports the allowance it just spent", () => {
  const response = badRequest("invalid_input", "Bad location.", 400, "req-1", GATE_HEADERS);

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("RateLimit-Limit"), "5");
  assert.equal(response.headers.get("RateLimit-Remaining"), "3");
});

test("a non-400 status still carries them", () => {
  const response = badRequest("conflict", "Already in progress.", 409, "req-2", GATE_HEADERS);

  assert.equal(response.status, 409);
  assert.equal(response.headers.get("RateLimit-Remaining"), "3");
});

// Callers that predate the gate — or sit before it — pass nothing, and must
// not gain empty or bogus headers by doing so.
test("omitting the headers adds none", () => {
  const response = badRequest("invalid_input", "Bad location.", 400, "req-3");

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("RateLimit-Limit"), null);
  assert.equal(response.headers.get("RateLimit-Remaining"), null);
});

test("the body shape is unchanged by the added headers", async () => {
  const response = badRequest("invalid_input", "Bad location.", 400, "req-4", GATE_HEADERS);

  assert.deepEqual(await response.json(), {
    error: { kind: "invalid_input", message: "Bad location.", requestId: "req-4" },
  });
});

test("a 429 reports Retry-After alongside the measured allowance", () => {
  const response = tooManyRequests("Slow down.", 30_000, "req-5", GATE_HEADERS);

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "30");
  assert.equal(response.headers.get("RateLimit-Limit"), "5");
});

// Deliberate, and worth pinning: RateLimit-* describes the caller's own
// allowance, which a capacity rejection leaves untouched. Attaching capacity
// numbers would put two different limits in one header family and publish how
// close the deployment is to its ceiling.
test("a capacity rejection carries Retry-After but no RateLimit headers", () => {
  const response = serviceAtCapacity("Service is busy.", 120_000, "req-6");

  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Retry-After"), "120");
  assert.equal(response.headers.get("RateLimit-Limit"), null);
  assert.equal(response.headers.get("RateLimit-Remaining"), null);
});
