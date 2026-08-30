/**
 * The public emergency number to surface for a resolved search location.
 *
 * Deliberately small and conservative: this app can be wrong about a clinic's
 * hours and the worst case is a wasted trip, but it can be wrong about an
 * emergency number and the worst case is much worse. Rather than guess at
 * every country's split police/fire/ambulance lines, this only claims a
 * number where it's unambiguous and well-established, and falls back to a
 * generic hedge everywhere else — the same "confirmed or Unknown" posture
 * the rest of the app takes toward every other fact.
 *
 * Keyed on the lowercase ISO 3166-1 alpha-2 code Nominatim returns.
 */
const KNOWN_NUMBERS: Record<string, string> = {
  // North America: shared numbering plan.
  us: "911",
  ca: "911",
  mx: "911",
  // The EU/EEA's common emergency number, adopted well beyond the bloc too.
  at: "112",
  be: "112",
  bg: "112",
  hr: "112",
  cy: "112",
  cz: "112",
  dk: "112",
  ee: "112",
  fi: "112",
  fr: "112",
  de: "112",
  gr: "112",
  hu: "112",
  is: "112",
  it: "112",
  lv: "112",
  li: "112",
  lt: "112",
  lu: "112",
  mt: "112",
  nl: "112",
  no: "112",
  pl: "112",
  pt: "112",
  ro: "112",
  sk: "112",
  si: "112",
  es: "112",
  se: "112",
  ch: "112",
  tr: "112",
  in: "112",
  // Keep their own long-standing numbers alongside 112.
  gb: "999",
  ie: "999",
  au: "000",
  nz: "111",
};

/**
 * The specific number when this app is confident about it, or `null` when it
 * isn't — callers are expected to fall back to a generic "your local
 * emergency number" phrasing rather than treat `null` as a missing feature.
 */
export function emergencyNumberFor(countryCode: string | null): string | null {
  if (!countryCode) return null;
  return KNOWN_NUMBERS[countryCode.toLowerCase()] ?? null;
}
