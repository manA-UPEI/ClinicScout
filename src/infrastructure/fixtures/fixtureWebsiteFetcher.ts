import type { FetchedPage } from "../../application/ports/websiteFetcher.ts";
import { fixturePageFor } from "./fixtureData.ts";

/**
 * Serves a clinic's canned page text, or nothing for a clinic that has no
 * fixture site.
 *
 * An empty array is the real fetcher's contract for a site it could not read,
 * and the inspection use-case already treats that as "no evidence, everything
 * stays Unknown" — so a seed with no `page` exercises the unreadable-site
 * path for free.
 */
export async function fixtureFetchClinicPages(startUrl: string): Promise<FetchedPage[]> {
  const text = fixturePageFor(startUrl);
  return text ? [{ url: startUrl, text }] : [];
}
