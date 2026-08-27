import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSubject } from "./rateLimitSubject.ts";
import type { AuthenticatedUser } from "../../domain/entities/user.ts";

const USER: AuthenticatedUser = {
  id: "github:1",
  email: "a@example.com",
  name: "Ada",
};

test("a signed-in caller is keyed on their account", () => {
  assert.deepEqual(resolveSubject(USER, "203.0.113.7"), {
    kind: "user",
    key: "github:1",
  });
});

// The point of the whole tier: the same person on a different network is
// still the same bucket, and rotating addresses buys nothing.
test("a signed-in caller keeps one bucket across addresses", () => {
  const a = resolveSubject(USER, "203.0.113.7");
  const b = resolveSubject(USER, "198.51.100.2");
  assert.equal(a.key, b.key);
});

test("an anonymous caller with an address is keyed on it", () => {
  assert.deepEqual(resolveSubject(null, "203.0.113.7"), {
    kind: "ip",
    key: "203.0.113.7",
  });
});

test("an anonymous caller with no address joins the shared bucket", () => {
  const subject = resolveSubject(null, null);
  assert.equal(subject.kind, "unidentified");
});

// Fail closed: if dropping a header produced a fresh key each time, omitting
// it would be a way to opt out of rate limiting entirely.
test("every unidentifiable caller lands in the same bucket", () => {
  assert.equal(resolveSubject(null, null).key, resolveSubject(null, null).key);
});
