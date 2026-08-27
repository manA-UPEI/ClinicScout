import type { AuthenticatedUser } from "../../domain/entities/user.ts";

/**
 * Reads the caller's session without naming who issued it.
 *
 * This is the seam that keeps Auth.js out of every layer above
 * infrastructure/: route handlers and (from Phase 2) the rate-limit gate ask
 * this port, never `next-auth` directly. Replacing the adapter — with a
 * hand-rolled OAuth + jose session, say — touches one file.
 *
 * Takes no argument because the cookie store the adapter reads is already
 * request-scoped by the framework.
 */
export interface SessionReader {
  /** The signed-in user, or null when the caller is anonymous, expired, or presenting a session that won't verify. */
  readUser(): Promise<AuthenticatedUser | null>;
}
