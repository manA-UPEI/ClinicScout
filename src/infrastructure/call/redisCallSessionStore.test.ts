import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedisCallSessionStore } from "./redisCallSessionStore.ts";
import type { RedisTransport } from "../cache/redisRestClient.ts";
import type { CallSession } from "../../domain/entities/call.ts";

/** An in-memory stand-in for Upstash, so these tests never touch the network. */
function fakeTransport(): RedisTransport {
  const store = new Map<string, string>();
  return {
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
    // RedisCallSessionStore never calls these — stubbed only to satisfy RedisTransport.
    async incr() {
      return 1;
    },
    async expire() {},
    async ttl() {
      return null;
    },
  };
}

function session(overrides: Partial<CallSession> = {}): CallSession {
  return {
    id: "session-1",
    clinicId: "node/123",
    clinicName: "Riverside Walk-In Clinic",
    phone: "902-555-0142",
    status: "awaiting_consent",
    transcript: [],
    outcome: null,
    createdAt: 0,
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

test("createIfFree claims the clinic and stores the session", async () => {
  const store = createRedisCallSessionStore(fakeTransport());
  const s = session();

  assert.equal(await store.createIfFree(s), true);
  assert.deepEqual(await store.get(s.id), s);
  assert.deepEqual(await store.findActiveFor(s.clinicId), s);
});

test("createIfFree refuses a second live call to the same clinic", async () => {
  const store = createRedisCallSessionStore(fakeTransport());
  const first = session({ id: "a" });
  const second = session({ id: "b" });

  assert.equal(await store.createIfFree(first), true);
  assert.equal(await store.createIfFree(second), false);
  // The refused claim must not have overwritten the first session's record.
  assert.deepEqual(await store.findActiveFor(first.clinicId), first);
});

test("a different clinic is unaffected by an active claim", async () => {
  const store = createRedisCallSessionStore(fakeTransport());
  const a = session({ id: "a", clinicId: "node/1" });
  const b = session({ id: "b", clinicId: "node/2" });

  assert.equal(await store.createIfFree(a), true);
  assert.equal(await store.createIfFree(b), true);
});

test("save() on a terminal status releases the claim for a new call", async () => {
  const store = createRedisCallSessionStore(fakeTransport());
  const s = session();
  await store.createIfFree(s);

  const finished = { ...s, status: "no_answer" as const, endedAt: 1000 };
  await store.save(finished);

  assert.equal(await store.findActiveFor(s.clinicId), undefined);
  assert.equal(await store.createIfFree(session({ id: "next", clinicId: s.clinicId })), true);
});

test("save() on a non-terminal status keeps the claim in place", async () => {
  const store = createRedisCallSessionStore(fakeTransport());
  const s = session();
  await store.createIfFree(s);

  const dialing = { ...s, status: "dialing" as const };
  await store.save(dialing);

  assert.deepEqual(await store.findActiveFor(s.clinicId), dialing);
  assert.equal(await store.createIfFree(session({ id: "other", clinicId: s.clinicId })), false);
});

test("get() returns undefined for a session that was never stored", async () => {
  const store = createRedisCallSessionStore(fakeTransport());
  assert.equal(await store.get("missing"), undefined);
});

test("findActiveFor returns undefined once the session it points at is gone", async () => {
  const store = createRedisCallSessionStore(fakeTransport());
  assert.equal(await store.findActiveFor("node/no-such-clinic"), undefined);
});
