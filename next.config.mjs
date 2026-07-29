/** @type {import('next').NextConfig} */

// Portfolio is a separate Vercel deployment served under /portfolio via rewrites.
// Set PORTFOLIO_URL in Vercel env (e.g. https://zerodayreapers-portfolio.vercel.app).
// Falls back to localhost:3001 for local dev (run the portfolio app on port 3001).
const PORTFOLIO_URL = process.env.PORTFOLIO_URL || "http://localhost:3001";

// Security headers applied to every response. Kept intentionally non-breaking:
// - HSTS enforces HTTPS (browsers ignore it on http/localhost, so dev is unaffected).
// - Frame/clickjacking: X-Frame-Options + CSP frame-ancestors 'none'.
// - The CSP is a SAFE SUBSET on purpose — it restricts base-uri / object-src /
//   frame-ancestors / form-action only, and deliberately does NOT set script-src /
//   connect-src / img-src so it can't break Turnstile, Supabase, or R2. Rolling out a
//   full nonce-based CSP (script-src/connect-src allowlist) is documented as a follow-up
//   in SECURITY_SETUP.md.
const CSP = [
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://api.web3forms.com",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig = {
  // Don't leak the framework/version in the Server response header.
  poweredByHeader: false,

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },

  async rewrites() {
    return [
      { source: "/portfolio", destination: `${PORTFOLIO_URL}/portfolio` },
      { source: "/portfolio/:path*", destination: `${PORTFOLIO_URL}/portfolio/:path*` },
    ];
  },
};

export default nextConfig;
