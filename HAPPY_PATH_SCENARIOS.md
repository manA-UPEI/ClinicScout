# ClinicScout Happy Path Test Scenarios

This document provides concrete test scenarios for manually validating the happy path through the ClinicScout system.

---

## Prerequisites

```bash
# Install dependencies
npm install

# Set up environment
cp .env.local.example .env.local
# Add your GEMINI_API_KEY to .env.local

# Run the development server
npm run dev
```

The app will be available at `http://localhost:3000`

---

## Test Scenario 1: Basic Happy Path (Online)

### Preconditions
- GEMINI_API_KEY is set in .env.local
- Internet connection available
- OpenStreetMap/Overpass API accessible
- Nominatim geocoding service accessible

### Test Steps

1. **Open Application**
   - Navigate to `http://localhost:3000`
   - See "ClinicScout AI" header
   - Three input fields visible: Location, Urgency, Max Radius

2. **Enter Location**
   - Input: `"Charlottetown, PEI"`
   - Expected: Field accepts text

3. **Select Urgency**
   - Select: `"urgent"`
   - Expected: Dropdown shows options (routine, urgent, emergency_adjacent)

4. **Set Radius**
   - Verify default: `5` km
   - Expected: Slider or number input

5. **Submit Form**
   - Click: "Search" button
   - Expected: Page transitions to "Searching" state with spinner

6. **Monitor Progress Steps**
   - Watch for step messages in order:
     ```
     🤖 Gemini agent planning the search...
     📍 Resolved "Charlottetown, PEI" to Charlottetown, PE, Canada
     🔍 Searching for clinics within 5 km... Found N general clinics
     🕵️ Reading M clinic websites...
       ✅ Clinic Name: confirmed <fields>
       ⚠️ Clinic Name: nothing verifiable on the site
     ⚖️ Comparing availability and ranking options...
     🏆 Recommending <Clinic Name>
     ```

7. **Verify Final Results**
   - Top-ranked clinic displayed
   - Address, phone, email shown (if verified)
   - Opening hours displayed
   - "Walk-ins: Yes/No/Unknown" shown
   - Distance shown
   - Confidence indicator present

8. **Check Recommendation Reasoning**
   - Scroll to see agent's reasoning for the pick
   - Should explain which fields were verified
   - Should mention urgency-appropriate factors

### Expected Outcomes
- ✅ System finds clinics in the area
- ✅ At least one clinic has a website to inspect
- ✅ Website inspection yields verified facts (or "Unknown" if site unavailable)
- ✅ Top-ranked clinic is shown
- ✅ Recommendation includes reasoning

### Failure Modes

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| "Please enter a location" | Location field empty | Enter a location |
| "Couldn't reach the AI model" | No GEMINI_API_KEY or quota | Check .env.local; verify quota |
| "The clinic directory didn't respond" | Overpass API down | Retry; issue temporary |
| Incomplete step list | Network interrupted | Check connection; retry |
| "Unknown" for all fields | No websites found or inspection failed | Expected in rural areas |

---

## Test Scenario 2: Fallback (API Key Missing)

### Preconditions
- GEMINI_API_KEY is **not** set or is empty
- Nominatim and Overpass APIs accessible

### Test Steps

1. **Open Application** without GEMINI_API_KEY
   - Navigate to `http://localhost:3000`
   - Page loads normally

2. **Submit Search**
   - Input: `"Boston, MA"`
   - Urgency: `"routine"`
   - Max Radius: `5` km

3. **Watch for Fallback Message**
   - Expected first step:
     ```
     🧭 No GEMINI_API_KEY set — running the built-in search pipeline instead of the agent.
     ```

4. **Monitor Results**
   - System still finds clinics
   - No website inspection (Gemini not available)
   - All fields stay "Unknown" (data from OSM only)
   - Ranking still applies

5. **Verify Ranking**
   - Closest clinics appear near top
   - Any OpenStreetMap-tagged walk-in clinics ranked higher

### Expected Outcomes
- ✅ System works without Gemini API
- ✅ Explicit message about using fallback
- ✅ Results based on OpenStreetMap data only
- ✅ Ranking waterfall still applied

---

## Test Scenario 3: Urgent Care Rules Enforcement

### Preconditions
- GEMINI_API_KEY set
- Location with multiple clinic options

### Test Steps

1. **Search with Urgent Urgency**
   - Location: `"Vancouver, BC"`
   - Urgency: `"urgent"`
   - Radius: `5` km

2. **Monitor Results**
   - Agent should prioritize clinics marked "open now"
   - System should show open status indicators
   - Warning if top picks have unknown hours

3. **Look for Urgency-Aware Language**
   - Message examples:
     ```
     "is open now — this is urgent so confirmed hours matter"
     "requires no appointment (matters for urgent care)"
     "has unknown hours (unknown might be open)"
     "is currently closed (can't recommend when urgent)"
     ```

4. **Compare Routine vs Urgent**
   - Note ranking differences between:
     - Urgent: Open clinics first
     - Routine: Appointment-only clinics acceptable

### Expected Outcomes
- ✅ Open clinics ranked higher when urgent
- ✅ Appointment-only clinics penalized when urgent
- ✅ Closed clinics shown as ineligible when urgent
- ✅ Messaging reflects urgency context

---

## Test Scenario 4: Dead-End Clinic Rejection

### Preconditions
- Search yields at least 2 clinics
- At least one has no contact info (address/phone/email)

### Test Steps

1. **Search for Dead-End Clinic Area**
   - Location: `"Rural area"` (city/area known for limited listings)

2. **Review Ranked Results**
   - Scroll through full ranking
   - Note any clinics with:
     ```
     Address: ❌ Not listed
     Phone: ❌ Not listed
     Email: ❌ Not listed
     ```

3. **Check Recommendation**
   - If dead-end clinic is ranked high, verify:
     - System did NOT recommend it
     - Better alternative exists and was recommended instead
     - Reasoning explains: "Look it up before travelling"

4. **Verify Error Messages**
   - If only dead-end clinics available:
     - System recommends it anyway (honest about no alternatives)
     - Message clearly states the limitation
     - Example: "We found no address, phone number, or email for this listing — look it up before travelling"

### Expected Outcomes
- ✅ Dead-end clinics not recommended when alternatives exist
- ✅ Dead-end clinics CAN be recommended if all alternatives are dead-ends
- ✅ Clear messaging about limitations
- ✅ User knows to verify before going

---

## Test Scenario 5: Fact Verification

### Preconditions
- GEMINI_API_KEY set
- Search location with clinic having active website

### Test Steps

1. **Search for Known Good Website**
   - Location with major clinic chains (CVS MinuteClinic, Walgreens Clinic, etc.)
   - These reliably have detailed websites

2. **Monitor Inspection Step**
   - Watch for:
     ```
     🕵️ Reading X clinic websites...
     ✅ Clinic Name: confirmed <field1>, <field2>, <field3>
     ```

3. **Review Final Results**
   - Click clinic for details
   - Check "Evidence" or "Verified from" section
   - Each claimed fact should have a quote source

4. **Verify Quote Accuracy**
   - Read quoted text from website
   - Confirm it matches the extracted claim
   - Example:
     ```
     Field: "accepts_walk_ins"
     Claim: "Yes"
     Quote: "Walk-in patients welcome — no appointment needed"
     ```

5. **Check Unknown Fields**
   - Fields without website confirmation should be:
     ```
     Status: Unknown (not listed)
     ```
   - NOT false/no (absence of info is not denial)

### Expected Outcomes
- ✅ Verified facts have associated quotes
- ✅ Quotes match website content
- ✅ Unknown fields properly distinguished from confirmed negatives
- ✅ No claims without evidence

---

## Test Scenario 6: Streaming & Real-Time Updates

### Preconditions
- Browser developer tools open
- Network tab visible

### Test Steps

1. **Open DevTools**
   - F12 or Right-click → Inspect
   - Go to Network tab

2. **Start Search**
   - Input: Any location
   - Click Search

3. **Monitor Network Request**
   - Find POST to `/api/search`
   - Click to inspect
   - Go to "Response" tab

4. **Watch Event Stream**
   - Expected format: Server-Sent Events (SSE)
   - Each event should look like:
     ```
     event: step
     data: {"id":"geocode","message":"📍 Resolved..."}

     event: step
     data: {"id":"search-5","message":"🔍 Found..."}

     event: result
     data: {"ranked":[...],"urgency":"urgent",...}
     ```

5. **Verify Step Order**
   - Steps should appear in logical sequence
   - Not all at once (proves true streaming)
   - Timestamp each step to verify order

### Expected Outcomes
- ✅ Response content-type is `text/event-stream`
- ✅ Steps appear as `event:` delimited messages
- ✅ Final result comes after all steps
- ✅ Frontend updates in real-time as events arrive

---

## Test Scenario 7: Error Recovery

### Preconditions
- Network should be intermittently slow or throttled

### Test Steps

1. **Enable Network Throttling**
   - DevTools → Network → Throttle (set to "Slow 3G")

2. **Start Search**
   - Any location

3. **Watch for Timeout/Retry**
   - If stuck, page should timeout and show:
     ```
     The agent ran out of time to finish reasoning — ranking what it had gathered instead.
     ```

4. **Disable Throttling**
   - Set throttle back to "No throttling"

5. **Try Again**
   - Search should complete successfully

### Expected Outcomes
- ✅ System survives slow network
- ✅ Clear error message if timeout
- ✅ Partial results still provided
- ✅ User informed of what happened

---

## Test Scenario 8: Browser Back Button

### Preconditions
- Recent search with results displayed

### Test Steps

1. **Get Results**
   - Complete a search to see recommendations

2. **Click Browser Back**
   - Use browser back button

3. **Observe Behavior**
   - Page should return to input form
   - Previous search cleared

4. **Start New Search**
   - Different location
   - Should work normally

### Expected Outcomes
- ✅ Back button works
- ✅ Can start new search
- ✅ No errors or stuck states
- ✅ Previous results properly cleared

---

## Test Scenario 9: Location Variations

Test with various location formats:

| Location | Expected Behavior |
|----------|-------------------|
| `"Toronto, ON"` | Resolves to Toronto, Ontario |
| `"Toronto"` | Resolves to Toronto (first match) |
| `"1 Queen St, Toronto"` | Resolves to that address |
| `"43.65, -79.38"` | Accepts coordinates |
| `"InvalidCity12345"` | Shows "Location not found" |
| `""` (empty) | Shows validation error |

---

## Test Scenario 10: Performance Check

### Test Steps

1. **Measure Load Time**
   - Time from page load to interactive: < 2s

2. **Measure Search Time**
   - Time from search click to first step: < 5s
   - Time from first step to final result: < 40s

3. **Measure Step Emission**
   - Time between step events: < 100ms
   - No big gaps where UI seems frozen

4. **Check Browser Performance**
   - DevTools → Performance
   - Record search execution
   - Look for:
     - No red blocks (jank)
     - No long main-thread blocking
     - Smooth 60fps updates

### Expected Outcomes
- ✅ Initial load < 2s
- ✅ Search starts within 5s
- ✅ Results within 40s total
- ✅ Smooth UI updates

---

## Automated Test Verification

To run all tests programmatically:

```bash
# Run all tests
npm test

# Run happy path tests only
npm test -- lib/happyPath.test.ts

# Run specific test suite
npm test -- lib/agentLoop.test.ts

# Run with verbose output
npm test -- --reporter=verbose
```

Expected output:
```
✅ 97 tests pass
✅ 0 tests fail
✅ ~1 second total runtime
```

---

## Checklist: Happy Path Verification

Use this checklist to verify all happy path aspects work:

- [ ] **Location Input**
  - [ ] Location field accepts text
  - [ ] Urgency dropdown works
  - [ ] Radius slider/input works

- [ ] **Geocoding**
  - [ ] Location resolves correctly
  - [ ] Coordinates match expected area
  - [ ] Display name is readable

- [ ] **Clinic Search**
  - [ ] Clinics are found
  - [ ] Count matches area
  - [ ] Specialty clinics excluded
  - [ ] Results sorted by distance

- [ ] **Website Inspection**
  - [ ] Multiple clinics inspected (up to 5)
  - [ ] Facts extracted from websites
  - [ ] Verified fields show evidence
  - [ ] Unknown fields properly marked

- [ ] **Ranking**
  - [ ] Open clinics ranked higher when urgent
  - [ ] Confirmed details ranked higher
  - [ ] Distance considered
  - [ ] Walk-in clinics preferred

- [ ] **Recommendation**
  - [ ] Top clinic displayed
  - [ ] Reasoning provided
  - [ ] Fields are verified or marked Unknown
  - [ ] Urgent care rules honored

- [ ] **Streaming**
  - [ ] Steps show in real-time
  - [ ] Progress visible to user
  - [ ] No lag between events
  - [ ] All steps received

- [ ] **Error Handling**
  - [ ] Network errors show message
  - [ ] Invalid location shows message
  - [ ] Timeouts handled gracefully
  - [ ] Fallback works if Gemini unavailable

- [ ] **Build Quality**
  - [ ] No TypeScript errors
  - [ ] No console errors
  - [ ] No unhandled exceptions
  - [ ] All tests pass

---

## Support

If any test scenario fails:

1. **Check Prerequisites**
   - Is GEMINI_API_KEY set (if needed)?
   - Is npm installed?
   - Is Node.js version 18+?

2. **Check Logs**
   - Server console: `npm run dev` output
   - Browser console: F12 → Console tab

3. **Check Status**
   - OpenStreetMap API down? → Check on status page
   - Nominatim geocoding down? → Try different location
   - Gemini quota exhausted? → Check quota in Google AI Studio

4. **Run Tests**
   - `npm test` to verify all functionality works
   - If tests fail, there's a code issue
   - If tests pass but manual fails, environment issue

