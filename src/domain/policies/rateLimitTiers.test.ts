import { test } from "node:test";
import assert from "node:assert/strict";
import {
  signingInWouldRaiseLimit,
  tierFor,
  type RateLimitedRoute,
  type SubjectKind,
} from "./rateLimitTiers.ts";

const ROUTES: RateLimitedRoute[] = ["search", "call"];
const KINDS: SubjectKind[] = ["user", "ip", "unidentified"];

test("every route/kind pair has a positive limit and window", () => {
  for (const route of ROUTES) {
    for (const kind of KINDS) {
      const rule = tierFor(route, kind);
      assert.ok(rule.limit > 0, `${route}/${kind} limit`);
      assert.ok(rule.windowMs > 0, `${route}/${kind} window`);
    }
  }
});

test("signing in never lowers a caller's ceiling", () => {
  for (const route of ROUTES) {
    for (const kind of KINDS) {
      assert.ok(
        tierFor(route, "user").limit >= tierFor(route, kind).limit,
        `${route}: signed-in should not be worse than ${kind}`
      );
    }
  }
});

// The anonymous tiers are what both routes enforced before accounts existed.
// Introducing accounts must not quietly take quota away from visitors who
// did nothing but keep using the app the way they always did.
test("anonymous callers keep the pre-accounts allowance", () => {
  assert.equal(tierFor("search", "ip").limit, 5);
  assert.equal(tierFor("call", "ip").limit, 8);
});

test("an unidentified caller is limited exactly as a known address is", () => {
  for (const route of ROUTES) {
    assert.deepEqual(tierFor(route, "unidentified"), tierFor(route, "ip"));
  }
});

test("all tiers of a route share one window, so a reset time means one thing", () => {
  for (const route of ROUTES) {
    const windows = new Set(KINDS.map((k) => tierFor(route, k).windowMs));
    assert.equal(windows.size, 1);
  }
});

test("offers sign-in as a fix only to callers it would actually help", () => {
  assert.equal(signingInWouldRaiseLimit("search", "ip"), true);
  assert.equal(signingInWouldRaiseLimit("search", "unidentified"), true);
  assert.equal(signingInWouldRaiseLimit("search", "user"), false);
});
