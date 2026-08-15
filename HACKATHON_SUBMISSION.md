## Inspiration
People needing care quickly often waste critical time calling multiple clinics just to find one that is open, walk-in friendly, and reachable. We built Clinic Scout AI to close that gap with a trustworthy, urgency-aware way to find care nearby.

## What it does
Clinic Scout AI helps users find nearby clinics and recommends the best next option based on urgency, availability, and actionability.

It does this by combining:
- location-based clinic discovery
- urgency-aware ranking
- website verification for practical details like hours, walk-in policy, and booking/contact options
- transparent step-by-step progress streaming
- clear Unknown states when facts cannot be verified

## How we built it
We built Clinic Scout AI as a Next.js app with a Gemini-powered tool-calling agent orchestrating clinic discovery and recommendation.

Core flow:
1. Geocode the user location.
2. Search nearby clinics from OpenStreetMap/Overpass.
3. Filter out specialty-only listings not suitable for general walk-in needs.
4. Rank results with a deterministic waterfall tuned for urgency.
5. Inspect clinic websites and keep only quote-verified facts.
6. Finalize a recommendation only if guardrails pass.

Architecture highlights:
- React frontend with real-time Server-Sent Events updates
- Agent orchestration with deterministic fallback when AI is unavailable
- Fact firewall so the model cannot invent clinic details
- Caching and retry logic for resilience against upstream failures
- Comprehensive test coverage for safety-critical behavior

## Challenges we ran into
- External service instability and rate limits from directory/geocoding providers
- AI quota limits and model availability during live runs
- Preventing hallucinated medical claims while keeping recommendations useful
- Parsing real-world opening-hours text safely without making risky assumptions
- Handling incomplete public data while preserving user trust

## Accomplishments that we're proud of
- Built a strong fact firewall: recommendations can only cite verified fields
- Added graceful degradation so the app still works when AI is unavailable
- Shipped a transparent UX that distinguishes verified facts from unknowns
- Implemented robust caching and stale-data fallback behavior
- Reached strong automated reliability with full passing test coverage

## What we learned
- In healthcare-adjacent products, traceability and correctness beat fluent wording
- Agentic systems need hard runtime guardrails, not prompt-only rules
- Explicit Unknown states are safer than inferred negatives
- Combining deterministic scoring with AI orchestration gives better reliability
- Streaming progress increases user trust in longer-running workflows

## What's next for Clinic Scout AI
- Improve relevance classification beyond keyword-only matching
- Expand coverage and language support for more regions
- Enhance hours handling for holidays and exceptional schedules
- Add user feedback loops to tune ranking quality over time
- Strengthen production observability and safety analytics
- Continue improving low-latency performance under constrained quotas

## Built With
- Next.js 16
- React 19
- TypeScript 5
- Tailwind CSS 4
- ESLint 9
- Gemini API
- OpenStreetMap and Overpass API
- Nominatim geocoding
- Server-Sent Events (SSE)
