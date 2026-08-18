import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// All four external services (Nominatim, Overpass, Gemini, clinic websites)
// are called server-side only — see ARCHITECTURE.md's "External services"
// table — so the client never needs connect-src beyond its own origin.
// 'unsafe-inline' covers Next's own hydration script/style tags and JSX
// `style={}` attributes; tightening to a per-request nonce is future work,
// not needed for this first pass. 'unsafe-eval' is dev-only — Fast Refresh
// needs it, production builds don't.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The app never uses any of these client capabilities — geocoding is a
  // typed address, not browser geolocation — so they're locked off entirely.
  {
    key: "Permissions-Policy",
    value: "geolocation=(), camera=(), microphone=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
