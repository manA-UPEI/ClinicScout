import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// All four external services (Nominatim, Overpass, Gemini, clinic websites)
// are called server-side only — see ARCHITECTURE.md's "External services"
// table — so the client never needs connect-src beyond its own origin. Auth
// runs server-side too: OAuth is redirects and server-to-server token
// exchange, so it adds no script-src or connect-src origin either. A hosted
// auth widget would have cost both.
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
  // The OAuth authorize endpoints sign-in submits into. Auth.js answers its
  // own same-origin form POST with a 302 to the provider, and the CSP3 spec
  // and browsers disagree about whether form-action re-checks a redirect —
  // Chrome does not, Firefox historically has. Naming the two origins costs
  // nothing and removes the disagreement. Sign-in is the only form in the app
  // that leaves the origin; everything else stays on 'self'.
  "form-action 'self' https://github.com https://accounts.google.com",
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
