/**
 * A short id for correlating an error shown to the user with the server log
 * line that explains it. Generated once per request; threaded into every
 * error response (so a user has something to quote) and into the matching
 * logger.error() call (infrastructure/logging/logger.ts, so that quote is
 * findable) — without this, a "it broke" report was unreproducible from
 * logs alone.
 */
export function generateRequestId(): string {
  return globalThis.crypto.randomUUID().slice(0, 8);
}
