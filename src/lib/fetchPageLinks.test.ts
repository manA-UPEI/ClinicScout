import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRelevantLinks } from "../infrastructure/web/httpWebsiteFetcher.ts";

const BASE = "https://example-clinic.org/";

test("picks hours- and contact-relevant same-origin links, ranked by keyword hits", () => {
  const html = `
    <nav>
      <a href="/">Home</a>
      <a href="/services">Our Services</a>
      <a href="/hours">Hours &amp; Location</a>
      <a href="/contact">Contact Us</a>
    </nav>
  `;
  const links = extractRelevantLinks(html, BASE);
  assert.deepEqual(links, [
    "https://example-clinic.org/hours",
    "https://example-clinic.org/contact",
  ]);
});

test("ignores cross-origin links even when the text looks relevant", () => {
  const html = `<a href="https://other-site.com/hours">Our Hours</a>`;
  assert.deepEqual(extractRelevantLinks(html, BASE), []);
});

test("skips mailto, tel, javascript, and bare anchors", () => {
  const html = `
    <a href="mailto:hours@example-clinic.org">Email for hours</a>
    <a href="tel:5551234">Call for hours</a>
    <a href="javascript:void(0)">Hours popup</a>
    <a href="#hours">Jump to hours</a>
  `;
  assert.deepEqual(extractRelevantLinks(html, BASE), []);
});

test("skips document and media links even if keyword-relevant", () => {
  const html = `<a href="/hours-poster.pdf">Hours poster</a>`;
  assert.deepEqual(extractRelevantLinks(html, BASE), []);
});

test("ignores links with no keyword relevance", () => {
  const html = `<a href="/team">Our Team</a><a href="/blog">Blog</a>`;
  assert.deepEqual(extractRelevantLinks(html, BASE), []);
});

test("deduplicates repeated links and respects the max count", () => {
  const html = `
    <a href="/hours">Hours</a>
    <a href="/hours">Hours</a>
    <a href="/contact">Contact</a>
    <a href="/walk-in">Walk-in info</a>
  `;
  assert.equal(extractRelevantLinks(html, BASE, 2).length, 2);
});

test("resolves relative hrefs against the base URL", () => {
  const html = `<a href="contact-us">Contact</a>`;
  assert.deepEqual(extractRelevantLinks(html, BASE), [
    "https://example-clinic.org/contact-us",
  ]);
});
