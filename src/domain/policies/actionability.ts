import type { Clinic } from "../entities/clinic.ts";

/**
 * Whether a recommendation can actually be used.
 *
 * Measured across live runs, 29-34% of listings carry no contact details and no
 * address, and three of every five top-ranked clinics had no contact channel at
 * all. The app's promise is a best option *plus a next action*, so a listing the
 * user can neither reach nor find is not a recommendation — it's a name.
 */

/** Any channel the user could use to reach the clinic. */
export function hasContactChannel(c: Clinic): boolean {
  return Boolean(c.booking_url || c.email || c.phone);
}

/** Somewhere the user could physically go. */
export function isLocatable(c: Clinic): boolean {
  return Boolean(c.address);
}

/**
 * Neither reachable nor findable. Missing only one of the two is survivable —
 * you can call for directions, or walk into a listed address — but missing both
 * leaves nothing to act on.
 */
export function isDeadEnd(c: Clinic): boolean {
  return !hasContactChannel(c) && !isLocatable(c);
}

/**
 * Whether the agent can offer to phone this clinic and ask about walk-in
 * availability on the user's behalf.
 *
 * A phone number is the whole requirement — the call asks questions and
 * commits to nothing, so no other field has to be known first. Kept here
 * beside the other reachability predicates so "we can contact this clinic"
 * keeps meaning one thing in one place.
 */
export function canAgentCall(c: Clinic): boolean {
  return Boolean(c.phone);
}
