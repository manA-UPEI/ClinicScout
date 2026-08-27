import { fixturesEnabled } from "../../infrastructure/config/fixtureMode.ts";

/**
 * The public entry point presentation uses to ask whether the data it is
 * about to render is invented.
 *
 * Same wiring shape as application/auth/getCurrentUser.ts and for the same
 * reason: the ESLint boundary rule stops `components/` reaching into
 * `infrastructure/` directly, and a server component has no composition root
 * to be injected from.
 */
export function usingFixtureData(): boolean {
  return fixturesEnabled();
}
