import type { ActionCase } from "../domain/entities/agentRun.ts";
import type { Clinic } from "../domain/entities/clinic.ts";
import { hasContactChannel } from "./tools/actionability.ts";

// Next-action routing logic (spec section 4):
// Case 1: booking_url present -> direct online booking.
// Case 2: email present AND email_booking_supported === true -> verified email booking.
// Case 3: email present but booking-via-email unclear -> unverified email warning.
// Case 4: no booking link, no email, but phone present -> call only.
// Defensive fallback: no contact channel known at all.
export function determineAction(c: Clinic): ActionCase {
  // Checked up front against the same predicate the ranking uses, so "we can
  // contact this clinic" can never mean two different things in two places.
  if (!hasContactChannel(c)) return { kind: "no_contact_available" };

  if (c.booking_url) return { kind: "book_online", bookingUrl: c.booking_url };
  if (c.email && c.email_booking_supported === true) {
    return { kind: "email_verified", email: c.email };
  }
  if (c.email) return { kind: "email_unverified", email: c.email };
  if (c.phone) return { kind: "call_only", phone: c.phone };
  return { kind: "no_contact_available" };
}
