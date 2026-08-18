import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFinalization } from "../application/search/citationGuard.ts";
import { createRunState, shortId } from "./agent/state.ts";
import type { RunState } from "./agent/state.ts";
import type { Clinic } from "../domain/entities/clinic.ts";
import type { InputFormData } from "../domain/entities/agentRun.ts";

const INPUT: InputFormData = {
  location: "Charlottetown, PEI",
  urgency: "urgent",
  maxRadiusKm: 5,
};

function clinic(overrides: Partial<Clinic> = {}): Clinic {
  return {
    clinic_name: "Test Clinic",
    address: "1 Main St",
    distance_km: 1.2,
    phone: "555-0100",
    email: null,
    website: "https://example.com",
    source_url: "https://www.openstreetmap.org/node/1",
    opening_hours: null,
    open_now: null,
    current_capacity: null,
    accepts_walk_ins: null,
    appointment_required: null,
    booking_url: null,
    email_booking_supported: null,
    confidence: "Medium",
    relevance: "general",
    specialty: null,
    evidence: [],
    ...overrides,
  };
}

function stateWith(...clinics: Clinic[]): RunState {
  return stateFor(INPUT, ...clinics);
}

function stateFor(input: InputFormData, ...clinics: Clinic[]): RunState {
  const state = createRunState(input);
  for (const c of clinics) state.clinics.set(shortId(c.source_url), c);
  return state;
}

test("accepts a finalization citing only confirmed fields", () => {
  const state = stateWith(
    clinic({
      accepts_walk_ins: true,
      phone: "555-0100",
      evidence: [{ field: "accepts_walk_ins", quote: "we accept walk-ins" }],
    })
  );

  const result = validateFinalization(
    state,
    {
      clinic_id: "node/1",
      reason: "Confirmed it takes walk-ins and it is the closest option.",
      cited_fields: ["accepts_walk_ins", "phone"],
    },
    "node/1"
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.reasoning.overrode_ranking, false);
});

test("rejects a clinic id that is not in state", () => {
  const state = stateWith(clinic());

  const result = validateFinalization(
    state,
    {
      clinic_id: "node/999",
      reason: "This one looks like the best choice available.",
      cited_fields: [],
    },
    "node/1"
  );

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /Unknown clinic_id/);
});

test("rejects citing a field the clinic never confirmed", () => {
  // accepts_walk_ins is null — Unknown, not false. The whole point of the
  // firewall is that the agent cannot argue from it either way.
  const state = stateWith(clinic({ accepts_walk_ins: null }));

  const result = validateFinalization(
    state,
    {
      clinic_id: "node/1",
      reason: "It accepts walk-ins so you can be seen without an appointment.",
      cited_fields: ["accepts_walk_ins"],
    },
    "node/1"
  );

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /no confirmed value for: accepts_walk_ins/);
});

test("rejects a field name that is not citable at all", () => {
  const state = stateWith(clinic());

  const result = validateFinalization(
    state,
    {
      clinic_id: "node/1",
      reason: "It has the best reviews of any clinic in the area.",
      cited_fields: ["reviews"],
    },
    "node/1"
  );

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /Not citable: reviews/);
});

test("rejects a finalization with no real reason", () => {
  const state = stateWith(clinic());

  const result = validateFinalization(
    state,
    { clinic_id: "node/1", reason: "best", cited_fields: [] },
    "node/1"
  );

  assert.equal(result.ok, false);
});

test("rejects an override that cites no confirmed facts", () => {
  // Unknown is the absence of a reason, not a reason.
  const result = validateFinalization(
    stateWith(clinic({ phone: "555-0100" }), clinic(MAYBE_OPEN)),
    {
      clinic_id: "node/1",
      reason: "Its hours are unknown, so it could well be open right now.",
      cited_fields: [],
    },
    "node/2"
  );

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /cited no confirmed facts/);
});

test("agreeing with the ranking needs no citation", () => {
  const result = validateFinalization(
    stateWith(clinic({ phone: "555-0100" })),
    {
      clinic_id: "node/1",
      reason: "It is the closest option and the ranking already favours it.",
      cited_fields: [],
    },
    "node/1"
  );

  assert.equal(result.ok, true);
});

test("flags an override when the pick is not the top-ranked clinic", () => {
  const state = stateWith(clinic({ phone: "555-0100" }));

  const result = validateFinalization(
    state,
    {
      clinic_id: "node/1",
      reason: "Ranked second, but it is the only one reachable by phone today.",
      cited_fields: ["phone"],
    },
    "node/2"
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok && result.reasoning.overrode_ranking, true);
});

// A confirmed-closed clinic cannot see anyone today, however good its walk-in
// policy is. The agent was observed making exactly this trade.
const CLOSED = { source_url: "https://www.openstreetmap.org/node/1", open_now: false };
const MAYBE_OPEN = {
  clinic_name: "Maybe Open Clinic",
  source_url: "https://www.openstreetmap.org/node/2",
  open_now: null,
};

function finalizeClosed(state: RunState) {
  return validateFinalization(
    state,
    {
      clinic_id: "node/1",
      reason: "It explicitly confirms walk-ins with no appointment needed.",
      cited_fields: ["accepts_walk_ins"],
    },
    "node/1"
  );
}

test("rejects a confirmed-closed clinic when urgent and something may be open", () => {
  const result = finalizeClosed(
    stateWith(clinic({ ...CLOSED, accepts_walk_ins: true }), clinic(MAYBE_OPEN))
  );

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /confirmed closed right now/);
  assert.match(result.ok ? "" : result.error, /Maybe Open Clinic/);
});

test("allows a confirmed-closed clinic when every alternative is closed too", () => {
  const result = finalizeClosed(
    stateWith(
      clinic({ ...CLOSED, accepts_walk_ins: true }),
      clinic({ ...MAYBE_OPEN, open_now: false })
    )
  );

  assert.equal(result.ok, true);
});

test("rejects a dead-end clinic when a reachable alternative exists", () => {
  // No address and no contact channel: nothing for the user to act on.
  const result = validateFinalization(
    stateWith(
      clinic({ ...CLOSED, open_now: true, address: null, phone: null }),
      clinic(MAYBE_OPEN)
    ),
    {
      clinic_id: "node/1",
      reason: "It is open right now and closest to the requested location.",
      cited_fields: [],
    },
    "node/1"
  );

  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.error, /no address, phone, email or booking link/);
});

test("allows a dead-end clinic when every alternative is a dead end too", () => {
  const result = validateFinalization(
    stateWith(
      clinic({ ...CLOSED, open_now: true, address: null, phone: null }),
      clinic({ ...MAYBE_OPEN, address: null, phone: null })
    ),
    {
      clinic_id: "node/1",
      reason: "Every nearby listing lacks contact details; this one is at least open.",
      cited_fields: [],
    },
    "node/1"
  );

  assert.equal(result.ok, true);
});

test("an unreachable alternative does not count as somewhere to be seen", () => {
  const result = finalizeClosed(
    stateWith(
      clinic({ ...CLOSED, accepts_walk_ins: true }),
      // No address and no contact channel: a name, not an option.
      clinic({ ...MAYBE_OPEN, address: null, phone: null, email: null, booking_url: null })
    )
  );

  assert.equal(result.ok, true);
});

test("routine care may still be sent to a currently-closed clinic", () => {
  // Nothing to work around when you are booking ahead anyway.
  const result = finalizeClosed(
    stateFor(
      { ...INPUT, urgency: "routine" },
      clinic({ ...CLOSED, accepts_walk_ins: true }),
      clinic(MAYBE_OPEN)
    )
  );

  assert.equal(result.ok, true);
});

test("unknown hours are not treated as closed", () => {
  // Unknown might be open; only a confirmed closure disqualifies.
  const result = validateFinalization(
    stateWith(
      clinic({ open_now: null, accepts_walk_ins: true }),
      clinic({ ...MAYBE_OPEN, open_now: true })
    ),
    {
      clinic_id: "node/1",
      reason: "It explicitly confirms walk-ins with no appointment needed.",
      cited_fields: ["accepts_walk_ins"],
    },
    "node/1"
  );

  assert.equal(result.ok, true);
});

test("an empty string counts as unconfirmed, not as a value", () => {
  const state = stateWith(clinic({ current_capacity: "" }));

  const result = validateFinalization(
    state,
    {
      clinic_id: "node/1",
      reason: "It reported plenty of remaining capacity for today.",
      cited_fields: ["current_capacity"],
    },
    "node/1"
  );

  assert.equal(result.ok, false);
});
