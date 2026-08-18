import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSseFrame, readSseStream } from "./sseFrame.ts";

test("parses an event frame", () => {
  const parsed = parseSseFrame('event: step\ndata: {"id":"geocode","message":"hi"}');
  assert.deepEqual(parsed, {
    event: "step",
    data: { id: "geocode", message: "hi" },
  });
});

test("joins a payload split across several data lines", () => {
  const parsed = parseSseFrame('event: result\ndata: {"a":\ndata: 1}');
  assert.deepEqual(parsed, { event: "result", data: { a: 1 } });
});

test("returns null for a frame with no data", () => {
  assert.equal(parseSseFrame("event: ping"), null);
});

test("returns null rather than throwing on malformed JSON", () => {
  assert.equal(parseSseFrame("event: step\ndata: {not json"), null);
});

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

test("reads events from a stream", async () => {
  const events = [];
  for await (const e of readSseStream(
    streamOf([
      'event: step\ndata: {"id":"a"}\n\n',
      'event: step\ndata: {"id":"b"}\n\n',
      'event: result\ndata: {"mode":"agent"}\n\n',
    ])
  )) {
    events.push(e);
  }

  assert.equal(events.length, 3);
  assert.equal(events[2].event, "result");
});

test("reassembles a frame split across chunk boundaries", async () => {
  // The realistic case: a network chunk ends mid-frame, which a naive
  // per-chunk parser would drop entirely.
  const events = [];
  for await (const e of readSseStream(
    streamOf(['event: step\nda', 'ta: {"id":"a"}', "\n\nevent: step\ndata: {\"id\":\"b\"}\n\n"])
  )) {
    events.push(e);
  }

  assert.deepEqual(
    events.map((e) => (e.data as { id: string }).id),
    ["a", "b"]
  );
});
