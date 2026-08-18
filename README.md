# ClinicScout AI

Finds nearby walk-in clinics, reads their websites to verify availability, ranks
them, and recommends one with a concrete next action.

For the structural view — request lifecycle, where state lives, the module map —
see [ARCHITECTURE.md](ARCHITECTURE.md). This file covers the reasoning behind it.

## Getting started

```bash
npm install
```

Copy `.env.local.example` to `.env.local` and add a free
[Google AI Studio key](https://aistudio.google.com/apikey):

```
GEMINI_API_KEY=your_key_here
```

Then:

```bash
npm run dev
```

The app runs without a key — it just skips website inspection, and any field the
directory data doesn't cover stays "Unknown".

## How it works

Gemini runs the search as an **agent**: it decides which tools to call, in what
order, when to stop, and which clinic to recommend. There is no fixed sequence —
a thin result set gets a wider radius, an uninformative website gets the next
candidate inspected instead.

The tools it drives are the same verified ones the app has always used:

| Tool | What it does |
|---|---|
| `geocode_location` | Resolve the typed location via Nominatim |
| `search_clinics` | Query OpenStreetMap (Overpass); specialty listings filtered out |
| `inspect_clinic_websites` | Fetch and read clinic sites, keeping only quote-verified facts |
| `rank_clinics` | Score with the deterministic waterfall |
| `get_clinic_details` | Read the full verified record, evidence quotes included |
| `finalize_recommendation` | Commit to a pick — validated before it is accepted |

### Gemini decides; it does not get to make things up

Putting a model in charge of a medical lookup is only safe if it cannot author a
fact. Two rules enforce that, and they are the load-bearing part of the design:

**Full clinic records never enter the model's context.** Tools return compact
projections plus ids; the real records stay server-side in `RunState`
([application/search/agentState.ts](src/application/search/agentState.ts)). The model can point at a clinic, never
rewrite one. This also keeps a dense city's hundred listings from swamping the
context window.

**The run ends by selecting an id, not by writing prose.** `finalize_recommendation`
takes a `clinic_id` and the `cited_fields` its reasoning depends on, and
[`validateFinalization`](src/application/search/citationGuard.ts) rejects the call if any cited field
is Unknown for that clinic. The rejection goes back to the model as a tool error,
so it corrects itself and retries. Its closing argument renders as clearly-labelled
*reasoning*, next to — never mixed into — the verified fact badges.

So the agent is free to overrule the deterministic ranking, and says so when it
does; it just cannot justify the overrule with something no source confirmed.

### When the agent cannot answer

No API key, no network, quota exhausted, out of turns, or out of time — the run
falls back to the original fixed pipeline
([`runDeterministicPipeline`](src/application/search/runDeterministicPipelineUseCase.ts)), and the step log says which
engine answered and why. If the agent already found clinics before it stopped,
that work is scored rather than thrown away and re-fetched.

### Watching it think

The run streams over SSE, so each decision appears as it is made rather than
replaying a canned animation after the fact. An inspection that takes four
seconds looks like four seconds.

**A note on quota.** The agent spends one model call per turn — five or six per
search, against the old extractor's one — so API budget is the first thing to run
out, and the single most likely thing to go wrong in a live demo. Both failure
modes were hit while building this: a per-model free-tier allowance
(`gemini-2.5-flash` permits 20 requests/day, about three agent runs) and
account-level `prepayment credits are depleted`, which no model change works
around. Either way the run degrades to the pipeline and the step log says so
rather than failing. See [.env.local.example](.env.local.example).

## Relevance filtering

`amenity=clinic|doctors` covers fertility labs, LASIK centres, optometrists and
physiotherapists alongside urgent care. Without filtering, the agent will
confidently recommend a behaviour-therapy clinic to someone with a sore throat —
which it did, before [`classifyClinic`](src/domain/policies/classifyClinic.ts) was added.

Listings are tiered `walk_in` > `general` > `unknown`, with `specialty` excluded
from ranking entirely and listed in an expandable panel so the filter is
auditable rather than a black box. A specialty name beats a walk-in name:
"walk-in" describes how you get seen, not what they treat.

Consistent with the rest of the app, classification only downgrades on
*positive* evidence — a listing it cannot place stays `unknown` and remains
eligible.

## Urgency

The selector changes behaviour rather than decorating the form:

- **Routine** — needing an appointment is no longer a penalty, since you can
  book ahead.
- **Urgent** — open-now and confirmed walk-in clinics rank first.
- **Emergency-adjacent** — ranks as urgent, and the results open with a banner
  telling the user to call 911 rather than travel to a clinic.

## Having the agent call the clinic

The one fact that decides whether a trip is worth making — *are you taking
walk-ins right now, and how long is the wait* — exists nowhere but in a
receptionist's head. It is not in OpenStreetMap and it is almost never on the
website. So the agent can phone and ask.

It **asks and hangs up**. There is no code path by which a call books anything,
which is why a hallucinated appointment is impossible here rather than merely
discouraged. What it learns comes back as findings you can act on yourself.

### The transcript is the new page text

Website facts survive only if a verbatim quote backs them. Call facts work the
same way — with one addition that a document does not need:

> The quote must come from a turn the **clinic** spoke. The agent cannot cite
> itself.

Half a transcript is the agent's own words. An agent that asks *"so that's about
forty-five minutes?"* and gets a noncommittal "mhm" could, given the whole
transcript, quote its own sentence as proof of a forty-five minute wait — a
number the clinic never said and merely failed to argue with. Building the
haystack from clinic turns only makes that impossible in code
([domain/verification/transcriptEvidence.ts](src/domain/verification/transcriptEvidence.ts)).

The visible result: a receptionist who says *"maybe, hard to say"* produces a
call that confirms **nothing**, and the UI says so. A system that returns "about
45 minutes" there invented it.

### It says what it is, and says nothing about you

Every call opens with a constant, non-skippable line stating that the caller is
an AI and the call is transcribed. It is not model-generated and it is always
first ([domain/services/callScript.ts](src/domain/services/callScript.ts)).

The script has exactly one slot — the clinic's name. There is no slot capable of
carrying a symptom, a name, or a callback number, so **the clinic learns nothing
about you**; `Urgency` shapes the ranking and never reaches the conversation.
That is enforced by the shape of the script rather than by asking a model to
behave, and `buildScript.length === 1` is asserted in the suite so a later change
that threads patient detail through fails before it ships.

The agent also withdraws rather than pressing on: a receptionist who says they
don't take automated calls gets an apology and a hang-up, and a phone tree gets
hung up on rather than read at.

### Simulated, for now

Calls run against a scripted receptionist — no telephony, no cost, nothing
dialled — the same honesty the email draft practises by labelling itself
"(Mock)". Seven personas cover the failure modes a real line actually produces:
helpful, appointment-only, **vague**, refuses-AI, voicemail, phone tree, and no
answer.

Everything above the provider boundary is real, so wiring live telephony is an
adapter (`CallProvider` in
[application/ports/callProvider.ts](src/application/ports/callProvider.ts)), not a rewrite. Doing
so needs more than code: a verified caller ID, a number allowlist, per-call rate
limits, and a look at the rules on AI-voice calls in the jurisdiction you are
dialling into. It is deliberately not wired up.

## Surviving a busy Overpass

The public Overpass instance rate-limits and occasionally 5xx's under load —
hit directly, more than once, while building this. A single failed request
used to end the whole search with an error the user could do nothing about.

Now: search results are cached per (rounded location, radius) for 24 hours, a
failed request is retried once with backoff before giving up, and if that
retry still fails, a cached result — even an expired one — is served rather
than nothing. The UI says so explicitly rather than presenting stale data as
fresh (`"⚠️ The clinic directory didn't respond — showing the most recent
results we have..."`), and the search screen itself says something if it's
been unusually slow, rather than leaving a static spinner up for a minute.

Gemini website inspection gets the same treatment for the same reason: it's
where the free API tier's quota actually ran out, live, while building this —
verified results are cached per clinic, and a request that hits the quota
wall falls back to a fact confirmed minutes earlier instead of silently
losing it back to "Unknown".

This also means repeating the same search is close to instant: confirmed live,
a repeat query dropped from ~7s to ~400ms with the network call skipped
entirely.

## Reading hours without guessing "open now"

Clinic websites state hours in prose ("Mon–Fri 9am–5pm"), but the app can only
evaluate the OSM `opening_hours` grammar. Rather than trust an LLM's
translation between the two directly, both halves of the claim are verified
independently:

- The raw hours text must pass the same verbatim-quote check as every other
  extracted field ([`verifyAgainstPage`](src/domain/verification/pageEvidence.ts)).
- Gemini's own OSM-syntax translation of that text is only trusted if it
  independently parses with the app's strict grammar
  ([`isValidOpeningHours`](src/domain/policies/openingHours.ts)) — the same parser that decides
  `open_now` for every OSM-sourced listing.

If either check fails, hours fall back to the display text with no computed
`open_now`, rather than risking a wrong verdict. In practice this means real
edge cases — hours that reference statutory holidays, for instance — correctly
resolve to "Unknown" rather than a guess, because evaluating a holiday
correctly requires a real calendar this app doesn't have.

## Zero hallucination

The agent must never invent a clinic fact, so unknown values stay `null` all the
way through and render as an explicit "Unknown" badge via
[`FieldValue`](src/components/FieldValue.tsx) — never a guessed "No".

Model output gets the same treatment. Every extracted field must be accompanied
by a quote copied verbatim from the page, and
[`verifyAgainstPage`](src/domain/verification/pageEvidence.ts) checks each quote actually
appears in the fetched text before the field is trusted. A fabricated or
paraphrased citation drops the field back to `null`. Surviving facts are shown in
the UI with a ✓ and their source quote.

Known limits, stated plainly:

- Only the top 5 candidates are inspected, and only up to 3 pages per clinic
  (landing page + 2 same-origin links), so a walk-in clinic ranked 6th or
  lower — or one whose hours live 3 clicks deep — never gets read. Bounded on
  purpose: a dense city returns 100+ listings.
- Hours involving anything beyond simple weekly schedules (public holidays,
  seasonal hours, "by appointment") correctly fall back to Unknown rather than
  a guess — see above.
- Relevance classification is keyword-based, so an oddly-named specialty clinic
  can slip through as `unknown`. The excluded panel makes the filter's decisions
  reviewable.
- OSM data can be stale or incomplete. The UI says to call ahead.

## Scripts

```bash
npm run dev        # dev server
npm run typecheck  # tsc --noEmit
npm test           # node --test over src/**/*.test.ts
npm run lint
```

Set `GEMINI_MODEL` to use a different model. The default is `gemini-2.5-flash`,
pinned rather than an alias — `gemini-flash-latest` resolved to a preview
model with a much tighter free-tier quota and caused a live 429 storm during
this app's own testing. A demo failing under load is worse than eventually
needing to bump a pinned id by hand.
