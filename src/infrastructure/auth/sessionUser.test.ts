import { test } from "node:test";
import assert from "node:assert/strict";
import { accountSubject, toAuthenticatedUser } from "./sessionUser.ts";

test("namespaces an account id by its provider", () => {
  assert.equal(accountSubject("github", "12345"), "github:12345");
});

test("keeps the same account id distinct across providers", () => {
  assert.notEqual(accountSubject("github", "1"), accountSubject("google", "1"));
});

test("maps a full session to a user", () => {
  const user = toAuthenticatedUser({
    user: { id: "github:1", name: "Ada", email: "ada@example.com" },
  });

  assert.deepEqual(user, { id: "github:1", email: "ada@example.com", name: "Ada" });
});

test("normalises withheld name and email to null rather than undefined", () => {
  const user = toAuthenticatedUser({ user: { id: "github:1" } });

  assert.deepEqual(user, { id: "github:1", email: null, name: null });
});

test("treats a missing session as anonymous", () => {
  assert.equal(toAuthenticatedUser(null), null);
});

test("treats a session with no user as anonymous", () => {
  assert.equal(toAuthenticatedUser({}), null);
});

// The bucket-collision guard: an id-less session must not become a signed-in
// caller keyed on "", or every one of them shares a single rate-limit bucket.
test("treats a session whose user has no id as anonymous", () => {
  assert.equal(toAuthenticatedUser({ user: { name: "Ada" } }), null);
});

test("treats an empty-string id as anonymous", () => {
  assert.equal(toAuthenticatedUser({ user: { id: "" } }), null);
});
