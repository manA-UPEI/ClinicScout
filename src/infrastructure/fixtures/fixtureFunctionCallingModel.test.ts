import { test } from "node:test";
import assert from "node:assert/strict";
import { createFixtureCallable } from "./fixtureFunctionCallingModel.ts";
import type { Content, ModelTurn } from "../llm/geminiFunctionCallClient.ts";

const callable = createFixtureCallable({
  systemInstruction: "",
  functionDeclarations: [],
});

const OPENING: Content = {
  role: "user",
  parts: [
    {
      text: "Find a walk-in clinic for this request:\n- location: <user_location>Toronto</user_location>",
    },
  ],
};

/** Appends a model turn plus the tool result it produced, as the loop does. */
function withResult(
  contents: Content[],
  name: string,
  response: Record<string, unknown>
): Content[] {
  return [
    ...contents,
    { role: "model", parts: [{ functionCall: { name, args: {} } }] },
    { role: "user", parts: [{ functionResponse: { name, response } }] },
  ];
}

function calledTool(turn: ModelTurn): string | null {
  return turn.kind === "calls" ? turn.calls[0].name : null;
}

test("opens by geocoding the location it was given", async () => {
  const turn = await callable([OPENING]);

  assert.equal(calledTool(turn), "geocode_location");
  assert.equal(
    turn.kind === "calls" ? turn.calls[0].args.location : null,
    "Toronto"
  );
});

test("walks geocode -> search (already ranked) -> inspect (already detailed) -> finalize", async () => {
  let contents = [OPENING];
  const order: (string | null)[] = [];

  const responses: Record<string, Record<string, unknown>> = {
    geocode_location: { display_name: "Toronto", lat: 1, lon: 2 },
    search_clinics: {
      clinics: [
        { id: "node/1", has_website: true },
        { id: "node/2", has_website: false },
      ],
      ranked: [
        { id: "node/1", name: "First Clinic", rank: 1 },
        { id: "node/2", name: "Second Clinic", rank: 2 },
      ],
    },
    inspect_clinic_websites: {
      results: [
        {
          id: "node/1",
          accepts_walk_ins: true,
          appointment_required: null,
          opening_hours: "24/7",
          current_capacity: null,
        },
      ],
      ranked: [
        { id: "node/1", name: "First Clinic", rank: 1 },
        { id: "node/2", name: "Second Clinic", rank: 2 },
      ],
    },
  };

  for (let i = 0; i < 3; i++) {
    const turn = await callable(contents);
    const name = calledTool(turn);
    order.push(name);
    contents = withResult(contents, name!, responses[name!]);
  }

  assert.deepEqual(order, [
    "geocode_location",
    "search_clinics",
    "inspect_clinic_websites",
  ]);

  const final = await callable(contents);
  assert.equal(calledTool(final), "finalize_recommendation");
  const args = final.kind === "calls" ? final.calls[0].args : {};
  assert.equal(args.clinic_id, "node/1");
  // Only the fields the inspect response actually confirmed — citing a null
  // one is exactly what the citation guard rejects. No get_clinic_details
  // call needed: the inspected clinic's details already came back above.
  assert.deepEqual(args.cited_fields, ["accepts_walk_ins", "opening_hours"]);
});

test("only inspects clinics that have a website to read", async () => {
  let contents = [OPENING];
  contents = withResult(contents, "geocode_location", {});
  contents = withResult(contents, "search_clinics", {
    clinics: [
      { id: "node/1", has_website: false },
      { id: "node/2", has_website: true },
    ],
    ranked: [
      { id: "node/1", name: "No Site" },
      { id: "node/2", name: "Has Site" },
    ],
  });

  const turn = await callable(contents);

  assert.equal(calledTool(turn), "inspect_clinic_websites");
  assert.deepEqual(
    turn.kind === "calls" ? turn.calls[0].args.clinic_ids : null,
    ["node/2"]
  );
});

test("skips inspection entirely when nothing has a website", async () => {
  let contents = [OPENING];
  contents = withResult(contents, "geocode_location", {});
  contents = withResult(contents, "search_clinics", {
    clinics: [{ id: "node/1", has_website: false }],
    ranked: [{ id: "node/1", name: "No Site" }],
  });

  assert.equal(calledTool(await callable(contents)), "get_clinic_details");
});

test("answers in prose rather than finalizing when the ranking is empty", async () => {
  let contents = [OPENING];
  contents = withResult(contents, "geocode_location", {});
  contents = withResult(contents, "search_clinics", { clinics: [], ranked: [] });

  const turn = await callable(contents);

  assert.equal(turn.kind, "text");
});
