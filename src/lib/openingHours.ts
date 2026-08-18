// Conservative parser for the OSM `opening_hours` tag.
//
// Zero-hallucination discipline applies here more than anywhere else: the real
// tag syntax is a full grammar (public holidays, month ranges, "sunrise",
// week numbers, fallback rules). We deliberately support only the handful of
// unambiguous shapes below and return null for everything else, because a
// wrong "Open now" is far worse than an honest "Unknown" for someone who may
// be sick and travelling to a clinic.

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface TimeSpan {
  startMinutes: number;
  endMinutes: number;
}

interface Rule {
  days: Set<number>;
  spans: TimeSpan[];
  closed: boolean;
}

function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 24 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function parseDayToken(token: string): number[] | null {
  const range = /^([A-Za-z]{2})-([A-Za-z]{2})$/.exec(token);
  if (range) {
    const start = DAYS.findIndex((d) => d.toLowerCase() === range[1].toLowerCase());
    const end = DAYS.findIndex((d) => d.toLowerCase() === range[2].toLowerCase());
    if (start === -1 || end === -1) return null;
    const days: number[] = [];
    // Day ranges wrap around the week (e.g. Sa-Su, Fr-Mo).
    for (let i = start; ; i = (i + 1) % 7) {
      days.push(i);
      if (i === end) break;
      if (days.length > 7) return null;
    }
    return days;
  }

  const single = DAYS.findIndex((d) => d.toLowerCase() === token.toLowerCase());
  return single === -1 ? null : [single];
}

function parseRule(rawRule: string): Rule | null {
  const rule = rawRule.trim();
  if (rule === "") return null;

  const parts = rule.split(/\s+/);
  const dayPart = parts[0];
  const timePart = parts.slice(1).join(" ").trim();

  const days = new Set<number>();
  for (const token of dayPart.split(",")) {
    const parsed = parseDayToken(token);
    if (!parsed) return null;
    parsed.forEach((d) => days.add(d));
  }

  if (/^(off|closed)$/i.test(timePart)) {
    return { days, spans: [], closed: true };
  }

  const spans: TimeSpan[] = [];
  for (const spanText of timePart.split(",")) {
    const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(spanText.trim());
    if (!m) return null;
    const startMinutes = parseClock(m[1]);
    const endMinutes = parseClock(m[2]);
    if (startMinutes === null || endMinutes === null) return null;
    spans.push({ startMinutes, endMinutes });
  }

  if (spans.length === 0) return null;
  return { days, spans, closed: false };
}

/**
 * Parses the OSM `opening_hours` grammar subset this module supports, or
 * returns null for anything outside it (holidays, months, sunrise/sunset,
 * open-ended ranges, malformed rules) — never a partial or guessed parse.
 *
 * Exported separately from `isOpenNow` so a candidate value can be checked
 * for validity without needing a clock — used to gate LLM-normalized hours
 * before they're trusted (see `isValidOpeningHours`).
 */
function parseOpeningHours(value: string): Rule[] | null {
  if (value === "24/7") {
    return [{ days: new Set([0, 1, 2, 3, 4, 5, 6]), spans: [{ startMinutes: 0, endMinutes: 1440 }], closed: false }];
  }

  // Anything referencing holidays, months, weeks, sunrise/sunset or open-ended
  // ranges is outside what we can evaluate correctly.
  if (/PH|SH|sunrise|sunset|dawn|dusk|week\s|easter|\bJan\b|\bFeb\b|\bMar\b|\bApr\b|\bMay\b|\bJun\b|\bJul\b|\bAug\b|\bSep\b|\bOct\b|\bNov\b|\bDec\b|\+/i.test(value)) {
    return null;
  }

  // Rules are officially ";"-separated, but "Mo-Fr 08:00-20:00, Sa 10:00-16:00"
  // is common in practice. Only split on a comma sitting between a time and a
  // following day token, so day lists ("Mo,We,Fr 09:00-12:00") and multiple
  // spans ("09:00-12:00,13:00-17:00") stay intact.
  const normalized = value.replace(
    /(?<=\d:\d{2})\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su)\b)/gi,
    ";"
  );

  const rules: Rule[] = [];
  for (const rawRule of normalized.split(";")) {
    if (rawRule.trim() === "") continue;
    const parsed = parseRule(rawRule);
    if (!parsed) return null;
    rules.push(parsed);
  }
  if (rules.length === 0) return null;

  return rules;
}

/**
 * Returns true/false when the tag can be parsed with confidence, or null when
 * the value uses syntax we do not support — never a guess.
 */
export function isOpenNow(
  openingHours: string | null,
  now: Date = new Date()
): boolean | null {
  if (!openingHours) return null;

  const value = openingHours.trim();
  if (value === "") return null;

  const rules = parseOpeningHours(value);
  if (!rules) return null;

  const today = now.getDay();
  const minutesNow = now.getHours() * 60 + now.getMinutes();

  // Later rules override earlier ones for the same day, matching OSM semantics
  // (e.g. "Mo-Fr 09:00-17:00; We off").
  let verdict: boolean | null = null;
  for (const rule of rules) {
    if (!rule.days.has(today)) continue;
    if (rule.closed) {
      verdict = false;
      continue;
    }
    verdict = rule.spans.some(
      (s) => minutesNow >= s.startMinutes && minutesNow < s.endMinutes
    );
  }

  // No rule mentions today. For a well-formed tag that means closed today.
  return verdict ?? false;
}

/**
 * Whether a string parses as valid OSM opening_hours syntax at all, without
 * evaluating it against a clock. Used to gate a value an LLM claims is an OSM
 * translation of a clinic's plain-English hours: if it doesn't parse, it is
 * never trusted, regardless of how confident the model sounded.
 */
export function isValidOpeningHours(value: string | null | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return parseOpeningHours(trimmed) !== null;
}
