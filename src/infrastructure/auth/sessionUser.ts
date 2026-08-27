import type { AuthenticatedUser } from "../../domain/entities/user.ts";

/**
 * The slice of an Auth.js `Session` this app actually reads.
 *
 * Declared structurally instead of importing next-auth's own type so that
 * this module — and its test — stay loadable under the raw `node --test`
 * runner, which has no Next.js runtime for `next-auth` to import
 * `next/server` from.
 */
export interface SessionLike {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
  };
}

/**
 * Builds the id that identifies a caller everywhere else in the app.
 *
 * Provider-namespaced so two providers can never collide on a numeric id,
 * and built from `providerAccountId` rather than email because the account
 * id is the one field the provider guarantees is stable and that the user
 * cannot choose. See AuthenticatedUser for what this costs.
 */
export function accountSubject(provider: string, providerAccountId: string): string {
  return `${provider}:${providerAccountId}`;
}

/**
 * Session -> AuthenticatedUser, or null when there isn't a usable one.
 *
 * A session whose user carries no id is treated as no session at all rather
 * than as a signed-in caller with a blank key. An identity with no stable id
 * is useless to the thing that consumes it — per-user rate limiting — and
 * defaulting it to "" would put every such caller in one shared bucket while
 * still granting them the signed-in tier's raised limit, which is the worst
 * of both. Anonymous callers do share a bucket by design (see SubjectKind in
 * domain/policies/rateLimitTiers.ts), but they share the anonymous ceiling
 * with it. Better to be honestly anonymous than falsely identified.
 */
export function toAuthenticatedUser(session: SessionLike | null): AuthenticatedUser | null {
  const user = session?.user;
  if (!user?.id) return null;

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name ?? null,
  };
}
