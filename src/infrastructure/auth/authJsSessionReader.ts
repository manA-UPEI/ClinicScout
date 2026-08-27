import type { SessionReader } from "../../application/ports/sessionReader.ts";
import type { AuthenticatedUser } from "../../domain/entities/user.ts";
import { auth } from "./nextAuth.ts";
import { toAuthenticatedUser } from "./sessionUser.ts";

/**
 * The SessionReader backed by Auth.js.
 *
 * Thin on purpose: `auth()` verifies the cookie and the pure mapper in
 * ./sessionUser.ts turns the result into a domain user, which is why the
 * interesting half of this adapter is unit-testable without a Next runtime.
 *
 * A session that fails to verify — wrong secret after a rotation, tampered
 * cookie, expired token — comes back from `auth()` as null, so it lands on
 * the anonymous path rather than raising. That is the behaviour we want:
 * a bad cookie should cost the caller their signed-in quota, not the page.
 */
export const authJsSessionReader: SessionReader = {
  async readUser(): Promise<AuthenticatedUser | null> {
    return toAuthenticatedUser(await auth());
  },
};
