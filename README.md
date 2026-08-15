# ClinicScout AI

Finds nearby walk-in clinics, reads their websites to verify availability, ranks
them, and recommends one with a concrete next action.

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

1. **Geocode** the typed location via Nominatim.
2. **Search** OpenStreetMap (Overpass) for clinics inside the radius.
3. **Classify** each listing and set aside specialty services.
4. **Rank** on directory data alone.
5. **Inspect** the top 5 results that publish a website: fetch the landing page
   plus up to two same-origin pages likely to carry hours or contact details
   (a `/hours` or `/contact` page, say), and ask Gemini to extract walk-in
   policy, appointment rules, hours, capacity, and contact details.
6. **Re-rank** on the enriched data and recommend a next action (book online,
   draft an email, or call).

## Relevance filtering

`amenity=clinic|doctors` covers fertility labs, LASIK centres, optometrists and
physiotherapists alongside urgent care. Without filtering, the agent will
confidently recommend a behaviour-therapy clinic to someone with a sore throat —
which it did, before [`classifyClinic`](lib/tools/classifyClinic.ts) was added.

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
  extracted field ([`verifyEvidence`](lib/tools/verifyEvidence.ts)).
- Gemini's own OSM-syntax translation of that text is only trusted if it
  independently parses with the app's strict grammar
  ([`isValidOpeningHours`](lib/openingHours.ts)) — the same parser that decides
  `open_now` for every OSM-sourced listing.

If either check fails, hours fall back to the display text with no computed
`open_now`, rather than risking a wrong verdict. In practice this means real
edge cases — hours that reference statutory holidays, for instance — correctly
resolve to "Unknown" rather than a guess, because evaluating a holiday
correctly requires a real calendar this app doesn't have.

## Zero hallucination

The agent must never invent a clinic fact, so unknown values stay `null` all the
way through and render as an explicit "Unknown" badge via
[`FieldValue`](components/FieldValue.tsx) — never a guessed "No".

Model output gets the same treatment. Every extracted field must be accompanied
by a quote copied verbatim from the page, and
[`verifyEvidence`](lib/tools/verifyEvidence.ts) checks each quote actually
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
npm run dev     # dev server
npm test        # node --test over lib/*.test.ts
npm run lint
```

Set `GEMINI_MODEL` to use a different model. The default is `gemini-2.5-flash`,
pinned rather than an alias — `gemini-flash-latest` resolved to a preview
model with a much tighter free-tier quota and caused a live 429 storm during
this app's own testing. A demo failing under load is worse than eventually
needing to bump a pinned id by hand.
