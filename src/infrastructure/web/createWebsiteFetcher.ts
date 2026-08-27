import type { FetchedPage } from "../../application/ports/websiteFetcher.ts";
import { fixturesEnabled } from "../config/fixtureMode.ts";
import { fixtureFetchClinicPages } from "../fixtures/fixtureWebsiteFetcher.ts";
import { fetchClinicPages as httpFetchClinicPages } from "./httpWebsiteFetcher.ts";

export type { FetchedPage };

/**
 * Canned pages when USE_FIXTURES is set, else the real SSRF-guarded fetcher.
 *
 * Worth noting which guarantee each side carries: the live fetcher's DNS and
 * private-range checks are a security control, and the fixture path replaces
 * them with never making a request at all — which is strictly safer, not a
 * relaxation.
 */
export function fetchClinicPages(startUrl: string): Promise<FetchedPage[]> {
  return fixturesEnabled()
    ? fixtureFetchClinicPages(startUrl)
    : httpFetchClinicPages(startUrl);
}
