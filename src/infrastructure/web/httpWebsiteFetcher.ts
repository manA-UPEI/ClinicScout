import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { USER_AGENT } from "../geo/nominatimGeocoder.ts";
import type { WebsiteFetcher } from "../../application/ports/websiteFetcher.ts";

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 500_000;
const MAX_TEXT_CHARS = 15_000;

/**
 * Clinic website URLs come from OpenStreetMap, which anyone can edit, so they
 * are untrusted input. Resolving the host and rejecting private ranges stops a
 * crafted entry from turning this server into a probe of its own network.
 */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase();
    if (v6 === "::1" || v6 === "::") return true;
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true;
    // IPv4-mapped addresses carry the v4 rules with them.
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }

  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

async function isSafeUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return isPrivateAddress(host) ? null : url;

  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return null;
    if (addresses.some((a) => isPrivateAddress(a.address))) return null;
  } catch {
    return null;
  }
  return url;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  "#39": "'",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
      const named = ENTITIES[code.toLowerCase()];
      if (named) return named;
      if (code.startsWith("#")) {
        const point = code.startsWith("#x")
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
        if (Number.isFinite(point)) return String.fromCodePoint(point);
      }
      return match;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();
}

export interface FetchedPage {
  url: string;
  text: string;
}

interface FetchedHtml {
  url: string;
  html: string;
}

/** Network fetch + SSRF guard + incremental decode, shared by every fetch below. */
async function fetchHtml(rawUrl: string): Promise<FetchedHtml | null> {
  const url = await isSafeUrl(rawUrl);
  if (!url) return null;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
  } catch {
    return null;
  }

  if (!response.ok || !response.body) return null;
  if (!response.headers.get("content-type")?.includes("text/html")) return null;

  // Decode incrementally so an unexpectedly huge page can't exhaust memory.
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let html = "";
  let size = 0;
  try {
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } catch {
    return null;
  } finally {
    await reader.cancel().catch(() => {});
  }

  return { url: response.url || url.toString(), html };
}

/** Returns null for anything unreachable, unsafe, or not HTML — never throws. */
export async function fetchPage(rawUrl: string): Promise<FetchedPage | null> {
  const fetched = await fetchHtml(rawUrl);
  if (!fetched) return null;
  const text = htmlToText(fetched.html).slice(0, MAX_TEXT_CHARS);
  return text.length === 0 ? null : { url: fetched.url, text };
}

const LINK_KEYWORDS = /hours?|opening|schedule|contact|walk[\s-]?in|about|location|visit|reach/i;
const SKIP_EXTENSIONS = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|mp4|css|js)(\?|#|$)/i;

/**
 * Same-origin links from a page worth following for hours/contact/walk-in
 * details, ranked by keyword relevance. Pure and network-free so it can be
 * tested directly against sample HTML.
 */
export function extractRelevantLinks(
  html: string,
  baseUrl: string,
  max = 2
): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const seen = new Set<string>([base.toString()]);
  const candidates: { url: string; score: number; order: number }[] = [];
  const linkPattern = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let order = 0;

  while ((match = linkPattern.exec(html))) {
    const hrefRaw = match[1].trim();
    if (!hrefRaw || hrefRaw.startsWith("#") || /^(mailto|tel|javascript):/i.test(hrefRaw)) {
      continue;
    }

    let url: URL;
    try {
      url = new URL(hrefRaw, base);
    } catch {
      continue;
    }
    url.hash = "";

    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    // Cross-origin links are simply never followed — narrower attack surface
    // than trying to specially sanitize them, and clinic hours/contact info
    // lives on the clinic's own site anyway.
    if (url.hostname !== base.hostname) continue;
    if (SKIP_EXTENSIONS.test(url.pathname)) continue;

    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);

    const linkText = match[2].replace(/<[^>]+>/g, " ");
    const hits = `${linkText} ${hrefRaw}`.match(new RegExp(LINK_KEYWORDS, "gi"));
    if (!hits) continue;

    candidates.push({ url: key, score: hits.length, order: order++ });
  }

  return candidates
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, max)
    .map((c) => c.url);
}

const MAX_INSPECTION_PAGES = 3;

/**
 * Fetches a clinic's landing page plus up to two same-origin pages likely to
 * carry hours or contact details. Landing-page-only inspection was found to
 * recover opening hours for roughly one listing in ten; the fields that
 * actually decide the ranking usually live on a separate /hours or /contact
 * page, not the page a site happens to open on.
 */
export async function fetchClinicPages(startUrl: string): Promise<FetchedPage[]> {
  const landing = await fetchHtml(startUrl);
  if (!landing) return [];

  const landingText = htmlToText(landing.html).slice(0, MAX_TEXT_CHARS);
  const landingPage: FetchedPage | null =
    landingText.length > 0 ? { url: landing.url, text: landingText } : null;

  const links = extractRelevantLinks(landing.html, landing.url, MAX_INSPECTION_PAGES - 1);
  const subpages = await Promise.all(links.map(fetchPage));

  const pages = [landingPage, ...subpages].filter((p): p is FetchedPage => p !== null);
  return pages.slice(0, MAX_INSPECTION_PAGES);
}

/** The WebsiteFetcher port implementation, adapting `fetchClinicPages` above. */
export function createHttpWebsiteFetcher(): WebsiteFetcher {
  return { fetchClinicPages };
}
