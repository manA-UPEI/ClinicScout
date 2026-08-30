import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchPage } from "./httpWebsiteFetcher.ts";

// fetchPage's SSRF guard (isSafeUrl) only ever validated the URL it was
// handed. With `fetch`'s automatic redirect-following, a clinic "website" —
// untrusted, publicly-editable OSM data — that 302s to a private or
// link-local address was followed straight there, after the one check meant
// to prevent exactly that had already passed and gone stale. These tests
// drive the real guard logic (URL parsing, isPrivateAddress, the manual
// redirect loop) against a mocked network transport, so no real request ever
// leaves this machine.

function mockResponse(overrides: Partial<{
  status: number;
  ok: boolean;
  url: string;
  location: string | null;
  contentType: string | null;
  text: string;
}>): Response {
  const {
    status = 200,
    ok = status >= 200 && status < 300,
    url = "",
    location = null,
    contentType = "text/html",
    text = "",
  } = overrides;

  return {
    status,
    ok,
    url,
    headers: {
      get: (h: string) => {
        const key = h.toLowerCase();
        if (key === "location") return location;
        if (key === "content-type") return contentType;
        return null;
      },
    },
    body: ok
      ? {
          getReader() {
            let sent = false;
            return {
              async read() {
                if (sent) return { done: true, value: undefined };
                sent = true;
                return { done: false, value: new TextEncoder().encode(text) };
              },
              async cancel() {},
            };
          },
        }
      : null,
  } as unknown as Response;
}

/** Installs a fake `fetch` for the duration of `run`, then restores the real one. */
async function withMockFetch<T>(
  handler: (url: string, init: RequestInit | undefined, callIndex: number) => Response,
  run: () => Promise<T>
): Promise<T> {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init, calls++);
  }) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("does not follow a redirect to a link-local address", async () => {
  let calls = 0;
  const result = await withMockFetch(
    () => {
      calls++;
      // The outer, SSRF-checked URL 302s straight to a cloud metadata address.
      return mockResponse({ status: 302, location: "http://169.254.169.254/latest/meta-data/" });
    },
    () => fetchPage("http://8.8.8.8/")
  );

  assert.equal(result, null);
  // The internal target must never be requested at all.
  assert.equal(calls, 1);
});

test("does not follow a redirect to a loopback address", async () => {
  const result = await withMockFetch(
    () => mockResponse({ status: 301, location: "http://127.0.0.1:6379/" }),
    () => fetchPage("http://8.8.8.8/")
  );
  assert.equal(result, null);
});

test("does not follow a redirect to a private RFC1918 address", async () => {
  const result = await withMockFetch(
    () => mockResponse({ status: 302, location: "http://10.0.0.1/admin" }),
    () => fetchPage("http://8.8.8.8/")
  );
  assert.equal(result, null);
});

test("still follows a redirect between two public addresses", async () => {
  const result = await withMockFetch(
    (_url, _init, i) =>
      i === 0
        ? mockResponse({ status: 301, location: "http://1.1.1.1/landing" })
        : mockResponse({ status: 200, url: "http://1.1.1.1/landing", text: "Hours: Mon-Fri 9-5" }),
    () => fetchPage("http://8.8.8.8/")
  );
  assert.deepEqual(result, { url: "http://1.1.1.1/landing", text: "Hours: Mon-Fri 9-5" });
});

test("gives up after too many redirect hops rather than looping forever", async () => {
  let calls = 0;
  const result = await withMockFetch(
    () => {
      calls++;
      return mockResponse({ status: 302, location: "http://1.1.1.1/next" });
    },
    () => fetchPage("http://8.8.8.8/")
  );
  assert.equal(result, null);
  // One initial request plus a bounded number of hops, not an unbounded chase.
  assert.ok(calls <= 7, `expected a bounded number of hops, got ${calls}`);
});
