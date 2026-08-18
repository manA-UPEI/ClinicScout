export interface FetchedPage {
  url: string;
  text: string;
}

/** Reads a clinic's own website. SSRF-guarded; never throws — an unreachable site yields an empty result. */
export interface WebsiteFetcher {
  fetchClinicPages(startUrl: string): Promise<FetchedPage[]>;
}
