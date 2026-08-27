import type { AuthenticatedUser } from "../../domain/entities/user.ts";
import { authJsSessionReader } from "../../infrastructure/auth/authJsSessionReader.ts";
import { isAuthConfigured } from "../../infrastructure/config/authProviders.ts";

/**
 * The public entry point presentation code uses to find out who is asking.
 *
 * Wires the real adapter itself rather than taking one as an argument, the
 * same shape runClinicSearchUseCase.ts already uses for the Gemini client:
 * server components have no composition root to be injected from, and the
 * alternative is letting components/ and app/ import an infrastructure
 * adapter directly — which the ESLint boundary rule in eslint.config.mjs
 * forbids, correctly.
 *
 * Reading this makes the calling route dynamic, since it reads cookies. That
 * is the intended cost: there is no useful static prerender of a page whose
 * header says whether you are signed in.
 */
export function getCurrentUser(): Promise<AuthenticatedUser | null> {
  return authJsSessionReader.readUser();
}

/**
 * Whether the deployment can actually sign anyone in.
 *
 * The UI asks before offering a sign-in link: a link that leads straight to
 * an Auth.js "no such provider" error is worse than no link, and a
 * deployment with no OAuth credentials — a local clone, a fork someone is
 * trying out — is expected to run anonymous-only rather than broken.
 *
 * Checking this first also keeps that case statically renderable, since
 * nothing reads cookies when there is no sign-in to offer.
 */
export function isSignInAvailable(): boolean {
  return isAuthConfigured();
}
