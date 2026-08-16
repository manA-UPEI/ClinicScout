# ClinicScout Internals

A visual walkthrough of how a search actually moves through the app — one
request, traced end to end. [README.md](README.md) covers *why* the
load-bearing decisions were made; [ARCHITECTURE.md](ARCHITECTURE.md) is the
full structural reference. This doc is the guided version of both: follow it
top to bottom to see the whole flow at a glance.

## 1. The big picture

A search is a single `POST /api/search` that stays open as a
Server-Sent-Events stream — the browser never polls; each step renders the
moment it happens. One fork picks the engine, and three different paths can
produce the final recommendation.

```mermaid
flowchart LR
    B["Browser<br/>app/page.tsx"] -->|"POST, stays open"| R["/api/search<br/>SSE: step, result, error"]
    R --> K{"GEMINI_API_KEY set?"}
    K -->|no| D["Deterministic pipeline<br/>geocode → search → rank → inspect → re-rank"]
    K -->|yes| A["Gemini agent loop<br/>≤10 turns · 40s budget"]
    A -->|finalize accepted| RES["AgentRunResult<br/>→ RecommendationView"]
    A -->|"time/turns out, has clinics"| S["Salvage<br/>re-rank what's already found"]
    A -->|"failed with nothing"| D
    D --> RES
    S --> RES
```

Whichever branch runs, the output is the same shape — the client never has to
special-case which engine answered. The deterministic pipeline sits under
*three* of the four paths out of that fork — it's not just a no-key fallback,
it's also what runs when the agent runs out of runway or fails outright.

## 2. One request, three endings

The step log always names which engine answered, because that's exactly the
kind of thing this app is otherwise careful never to leave implicit.

| Outcome | `mode` | When it happens |
|---|---|---|
| **Agent finalized** | `agent` | The model called `finalize_recommendation` and it passed validation. |
| **Salvage** | `deterministic` | The loop ran out of time or turns, or lost the model mid-run — but had already found clinics, so that work gets scored rather than thrown away. |
| **Fixed pipeline** | `deterministic` | No API key configured, or the agent failed before gathering anything at all. |

A geocoding or directory failure raises an error *before* either engine can
produce anything — that path exits ahead of the fork, not after it.

### Why the numbers are what they are

Every budget below is chained to the deployment ceiling, not picked freely.

| Budget | Value | Why |
|---|---|---|
| Vercel Hobby function ceiling | **60s** | The hard limit — `maxDuration` in `route.ts` |
| Agent loop budget | **40s** | Leaves room to fall back and still answer rather than dying mid-stream |
| Max turns | **10** | Each turn is a round-trip against a free-tier quota |

## 3. Where state lives

The agent's blackboard is `RunState` (`lib/agent/state.ts`), and the boundary
drawn around it is the reason a model can be put in charge of a medical
lookup at all.

**Full clinic records never enter the model's context.** Tools hand Gemini a
compact projection plus a short id like `node/123`, and read the real record
back out by id server-side. Two things follow: a dense city's hundred
listings can't swamp the context window, and it's structurally impossible for
the model to alter a clinic fact — it can only ever point at one.

What accumulates in `RunState` across a run: clinics found so far (deduped by
id, surviving a widened re-search with their inspection results intact),
excluded specialty listings, the radius actually searched, which clinics have
already been inspected, and the finalization once it's accepted.

## 4. The fact firewall

Two different moments ask the same question — *is there anything real behind
this claim?* — and answer it the same way: discard rather than soften.

**Lane A — a fact entering from a website**

A clinic's site is fetched (SSRF-guarded, 3 pages max) and Gemini extracts a
field value plus a claimed supporting quote. `verifyEvidence` checks: does
that quote actually appear on the fetched page, verbatim?

- ✅ **Kept** — written to the record, confidence raised to High
- ❌ **Discarded** — field forced to `null` → renders "Unknown"

**Lane B — a fact the agent cites to justify a pick**

`finalize_recommendation` arrives with a `clinic_id`, a reason, and the
`cited_fields` the reasoning depends on. `validateFinalization` checks: is
every cited field confirmed (not null) — and is the pick reachable, and not
closed while the request is urgent?

- ✅ **Accepted** — promoted to rank 1, reasoning shown as reasoning
- ❌ **Rejected** — sent back as a tool error — the model retries

Lane A decides what a clinic record is allowed to *contain*. Lane B decides
what the agent is allowed to *say* about it — and carries an extra gate Lane
A doesn't need, because a verified fact can still add up to an unusable
recommendation.

### The usability floor

The agent is free to overrule the deterministic ranking below, and most of
that waterfall really is a judgment call. Two checks aren't, because a wrong
call there hands a sick person a clinic they can't reach or one that's shut —
both were observed happening in testing, which is why they're enforced in
code rather than requested in the prompt.

| Floor | Rule |
|---|---|
| **Reachability** | No address, phone, email, or booking link is a name, not a recommendation — can't be finalized while any reachable alternative exists. |
| **Urgency** | A confirmed-closed clinic can't be finalized for an urgent request while any alternative might be open. Unknown hours pass — unknown might mean open. |

Each check only bites while a genuinely better option exists — if every
nearby clinic is a dead end, saying so honestly is the best answer available,
and the agent is free to give it.

## 5. The priority waterfall

`rankClinics` compares tier by tier — a tie falls through to the next
criterion instead of collapsing into one sort key. The agent can recommend a
lower tier, but only by citing a confirmed fact the waterfall couldn't see.

| Tier | Criterion | Note |
|---|---|---|
| 0 | Usable at all | No contact channel *and* no address sinks a listing regardless of everything below |
| 1 | Open right now | Confirmed open beats unknown beats confirmed closed |
| 2 | Relevance | `walk_in` > `general` > `unknown` |
| 3 | Walk-ins explicitly confirmed | |
| 4 | Capacity or wait time known | |
| 5 | No appointment required | Skipped for routine care — you can book ahead |
| 6 | Reachable by some contact channel | Deliberately above distance: reachable beats 100m closer but silent |
| 7 | Shortest distance | |
| 8 | Higher source confidence | |

## 6. Teaching the agent to call a clinic

The one fact that decides whether a trip is worth making — *are you taking
walk-ins right now* — lives nowhere but in a receptionist's head. It's a
separate, user-initiated flow: the search loop budgets 40s for a whole run,
and a phone call is minutes.

```mermaid
flowchart LR
    C["CallConsentModal<br/>shows the exact script"] -->|user approves| P["POST /api/call<br/>rejects without consented:true"]
    P --> S["createSession<br/>one live call per clinic"]
    S --> V["CallProvider.place<br/>mock today"]
    V -->|"onTurn, streamed as SSE"| T["Transcript<br/>each turn tagged agent / clinic"]
    T --> X["extractFindings"]
    X --> Q{"quote found in a<br/>CLINIC turn?"}
    Q -->|yes| Kp["Kept — shown with ✓ and quote"]
    Q -->|no| U["Rejected — renders Unknown"]
```

A provider only ever produces speech; turning speech into a claimed fact, and
a claimed fact into a confirmed one, happens after the line is down — in code
the provider cannot influence.

**Why the haystack excludes the agent's own words:** half a transcript is the
agent talking. An agent that asks *"so that's about forty-five minutes?"* and
gets a noncommittal "mhm" could, given the whole transcript, quote its own
sentence as proof — a number the clinic never said. Restricting the haystack
to clinic turns removes the possibility in code, the same move the app makes
everywhere it puts a model near a claim.

### Constraints carried by the design, not the prompt

| Concern | Where it's enforced |
|---|---|
| Undisclosed AI caller | `DISCLOSURE` is a constant at index 0 of `buildScript` — never model-generated, always first |
| Patient detail leaking | The script has exactly one slot — the clinic's name. `buildScript.length === 1` is asserted in the test suite |
| Booking something unreviewed | No commitment path exists in this phase — it asks and hangs up |
| Repeated calls to one clinic | `activeSessionFor` — one live session per clinic |
| A call that never ends | `MAX_CALL_MS` plus the user's abort, combined into one signal in `runCall` |
| Mining a voicemail for facts | `buildOutcome` discards all findings unless the call status is `completed` |

Today it dials a scripted receptionist — seven personas cover the failure
modes a real line produces: helpful, appointment-only, vague, refuses-AI,
voicemail, phone tree, no answer. Everything above the provider boundary is
real, so live telephony is an adapter swap, not a rewrite — deliberately not
wired up yet, since it needs a verified caller ID, a number allowlist, rate
limits, and a look at the AI-voice disclosure rules for the jurisdiction
being dialled into.

## 7. Where each piece lives

<details>
<summary><strong>Client — 11 modules</strong></summary>

| Module | Role |
|---|---|
| `app/page.tsx` | Phase state machine — input, searching, progress, recommendation, error; owns the fetch and SSE read loop |
| `InputForm.tsx` | Location, urgency and radius |
| `SearchingState.tsx` | Pre-stream spinner; speaks up if the directory is slow past 12s |
| `AgentProgress.tsx` | Live transparency log — one line per streamed step |
| `RecommendationView.tsx` | Best pick, alternatives, agent rationale, set-aside specialty listings |
| `ClinicCard.tsx` | One clinic, with a ✓ on each field quoted from its own site |
| `FieldValue.tsx` | The only renderer for a nullable field — always "Unknown", never a guessed "No" |
| `ActionPanel.tsx` | Renders whichever next action `determineAction` selected |
| `EmailDraftModal.tsx` | Editable draft, explicitly mocked — nothing is ever sent |
| `EmergencyBanner.tsx` | Sits above results when the request is emergency-adjacent |
| `ErrorState.tsx` | Renders an AgentError by kind, with a retry |

</details>

<details>
<summary><strong>API &amp; orchestration — 3 modules</strong></summary>

| Module | Role |
|---|---|
| `api/search/route.ts` | The single POST endpoint; opens the stream, emits step / result / error |
| `agent/index.ts` | `runClinicSearch()` — picks the engine, always announces which one answered |
| `runAgent.ts` | `runDeterministicPipeline()` — the fixed pipeline, also the fallback |

</details>

<details>
<summary><strong>Agent internals — 5 modules</strong></summary>

| Module | Role |
|---|---|
| `runGeminiAgent.ts` | The turn loop: system instruction, budget, turn cap, one nudge to finalize, salvage on early exit |
| `toolRegistry.ts` | The six callable tools, their declarations, server-side clamps like the radius ceiling |
| `state.ts` | `RunState` blackboard and the projection boundary |
| `guards.ts` | `validateFinalization()` — the citation check and the usability floor |
| `gemini/functionCall.ts` | Function-calling client; replays model parts verbatim to preserve thought signatures |

</details>

<details>
<summary><strong>Domain tools — 12 modules</strong></summary>

| Module | Role |
|---|---|
| `geocode.ts` | Nominatim lookup |
| `searchClinics.ts` | Overpass query with retry/backoff; 24h cache serving stale over nothing |
| `classifyClinic.ts` | Tiers a listing walk_in / general / specialty / unknown — downgrades only on positive evidence |
| `calculateDistance.ts` | Great-circle distance, labelled straight-line rather than routing |
| `rankClinics.ts` | The waterfall, plus per-clinic rationale text |
| `inspectClinic.ts` | Runs one website's extraction, verification, caching and merge back into the record |
| `fetchPage.ts` | SSRF-guarded fetch, HTML-to-text, same-origin link discovery |
| `gemini.ts` | Single-shot structured-JSON extraction client; returns null on any failure |
| `verifyEvidence.ts` | Quote verification, plus the separate gate on translated opening hours |
| `actionability.ts` | `hasContactChannel` / `isLocatable` / `isDeadEnd` — shared by ranking, guards and UI |
| `cache.ts` | TTL cache with an injectable clock and a deliberate stale read |
| `openingHours.ts` | Conservative OSM opening_hours parser — unsupported syntax returns null, never a guess |

</details>

<details>
<summary><strong>Calling subsystem — 8 modules</strong></summary>

| Module | Role |
|---|---|
| `call/types.ts` | CallSession, CallStatus, CallTurn, findings, user-facing status notes |
| `call/script.ts` | The bounded script, the disclosure, refusal/IVR/voicemail detectors |
| `call/session.ts` | Lifecycle state machine and the in-process session store |
| `call/verifyTranscript.ts` | The clinic-turns-only firewall and `buildOutcome` |
| `call/extractFindings.ts` | Proposes findings — Gemini when configured, a conservative sentence scan otherwise |
| `call/runCall.ts` | Drives one call: dial, stream turns, extract, verify, record |
| `call/providers/index.ts` | The CallProvider interface, shaped for Twilio Media Streams + Gemini Live |
| `call/providers/mock.ts` | Seven scripted receptionists, one per real-world failure mode |

</details>

## 8. Tests & failure handling

`node --test` over `lib/*.test.ts`, no network access — the agent loop takes
`callModel` and `runTool` as parameters precisely so a whole run can be
driven from a scripted transcript without a key.

| Stat | Value |
|---|---|
| Repeat search, cache hit vs. cold | **~7s → ~400ms** (confirmed live) |
| Overpass result cache TTL | **24h** — expired cache still beats no result |
| `gemini-2.5-flash` free-tier request cap | **20/day** ≈ 3 agent runs |

Coverage leans toward the places where being wrong would be *dangerous*
rather than merely incorrect:

- `agentGuards.test.ts` — the citation check and both usability floors
- `agentLoop.test.ts` — budget and turn-cap termination, salvage, the finalize nudge
- `verifyEvidence.test.ts` — fabricated and paraphrased quotes dropping their fields
- `openingHours.test.ts` — the parser refusing to guess
- `classifyClinic.test.ts` — specialty names beating walk-in names
- `callTranscript.test.ts` — the call firewall, including a quote lifted from the agent's own turn
- `callScript.test.ts` — disclosure first, no slot able to carry patient detail
- `callSession.test.ts` — lifecycle transitions, hang-up at every live stage, one call per clinic
- `callMockProvider.test.ts` — each persona's terminal status, the vague clinic confirming nothing

Model pinned to `gemini-2.5-flash` rather than an alias —
`gemini-flash-latest` resolved to a preview model with a much tighter quota
and caused a live 429 storm during testing. A demo failing under load is
worse than eventually bumping a pinned id by hand.
