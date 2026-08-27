/** The OAuth providers this app is wired for. Adding one means adding its factory in ../auth/nextAuth.ts too. */
export type AuthProviderId = "github" | "google";

const SUPPORTED: readonly AuthProviderId[] = ["github", "google"];

/**
 * Which providers actually have credentials in the environment.
 *
 * The variable names (`AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET`, and the same
 * shape for Google) are Auth.js's own inference convention, not a second one
 * invented here — Auth.js reads them itself, so registering a provider whose
 * pair is set is all that's needed to configure it.
 *
 * Filtering matters at both ends: Auth.js fails a sign-in attempt against a
 * provider with no client id, and the UI should not offer a button that
 * cannot work. A deployment with only GitHub set up is a valid deployment.
 *
 * The one place these are read from process.env, the same role
 * ./env.ts plays for GEMINI_* and ./redisConfig.ts for Upstash.
 */
export function readConfiguredAuthProviders(): AuthProviderId[] {
  return SUPPORTED.filter((id) => {
    const prefix = `AUTH_${id.toUpperCase()}`;
    return Boolean(process.env[`${prefix}_ID`] && process.env[`${prefix}_SECRET`]);
  });
}

/**
 * Whether signing in can work at all.
 *
 * Both halves are required, and the failure modes differ enough to be worth
 * separating in your head: with no AUTH_SECRET, Auth.js cannot sign or
 * decrypt a session cookie and every sign-in errors; with no provider
 * credentials, there is nothing to sign in *with*. Either way the app still
 * runs — anonymous access is a supported tier, not a degraded one — so this
 * is reported through /api/health rather than thrown at boot.
 */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.AUTH_SECRET) && readConfiguredAuthProviders().length > 0;
}
