/**
 * Who the caller is, once a session has been read — the domain's entire view
 * of a signed-in person. Deliberately narrower than the provider's profile:
 * everything here is either the quota key or something shown back to the
 * user, and nothing else earns its place in the payload.
 */
export interface AuthenticatedUser {
  /**
   * Stable, unspoofable, and namespaced by provider — `github:12345`, not a
   * bare account id and not an email address.
   *
   * Namespaced because there is no database and therefore no account
   * linking: the same person signing in with GitHub and with Google is two
   * ids here. That is a known limit rather than an oversight. As a
   * rate-limit key it means one person can hold two buckets — 2x quota, not
   * unlimited — which is the cheap side of the trade. Keying on email would
   * collapse the two, but would also let a provider that hands back an
   * address it never verified sit in someone else's bucket. Linking them
   * properly needs a user table; see ARCHITECTURE.md.
   */
  id: string;
  /** Display only, never a key. Null when the provider withholds it. */
  email: string | null;
  name: string | null;
}
