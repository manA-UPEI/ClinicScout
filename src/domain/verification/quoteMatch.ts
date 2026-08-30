/**
 * The primitive the website-claim fact-firewall uses: normalize a string for
 * comparison, then check whether a quote appears verbatim in one of a list
 * of candidate sources.
 *
 * This module has no opinion about what a "source" is — a whole page's text,
 * or something narrower — that choice, and any pre-filtering of which
 * sources are even eligible, belongs to the caller.
 */

/** Shorter than this matches incidentally and proves nothing. */
export const MIN_QUOTE_CHARS = 4;

/**
 * Case- and whitespace-insensitive form used for quote matching. HTML-to-text
 * flattening and speech transcription both mangle whitespace and casing
 * without changing what was said, so neither should defeat a genuine quote.
 */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

export interface QuoteSource<K> {
  key: K;
  /** Already normalized, or raw — findVerbatimMatch normalizes it either way. */
  text: string;
}

/**
 * Finds the first source whose text contains the quote, or null if the quote
 * is too short to be meaningful or matches nothing. Both the quote and every
 * source's text are normalized via `normalizeForMatch` before comparing.
 */
export function findVerbatimMatch<K>(
  quote: string,
  sources: QuoteSource<K>[],
  minChars: number = MIN_QUOTE_CHARS
): QuoteSource<K> | null {
  const needle = normalizeForMatch(quote);
  if (needle.length < minChars) return null;

  for (const source of sources) {
    if (normalizeForMatch(source.text).includes(needle)) return source;
  }
  return null;
}
