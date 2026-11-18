/** @type {import('next').NextConfig} */

// Portfolio is a separate Vercel deployment served under /portfolio via rewrites.
// Set PORTFOLIO_URL in Vercel env (e.g. https://zerodayreapers-portfolio.vercel.app).
// Falls back to localhost:3001 for local dev (run the portfolio app on port 3001).
const PORTFOLIO_URL = process.env.PORTFOLIO_URL || "http://localhost:3001";

// Security headers applied to every response.
// - HSTS enforces HTTPS (browsers ignore it on http/localhost, so dev is unaffected).
// - Frame/clickjacking: X-Frame-Options + CSP frame-ancestors 'none'.
// - CSP: an explicit allowlist (script/style/connect/img/font/frame/worker) rather than the old
//   safe-subset. Supabase / Umami / Sentry origins are derived from env so the policy matches whatever
//   this deployment actually talks to; Turnstile, R2 and Google Fonts are fixed origins. Inline
//   script/style stay allowed ('unsafe-inline') because the app isn't nonce-based yet (a full nonce
//   CSP needs middleware). ROLLOUT: set CSP_REPORT_ONLY=1 to ship it as Content-Security-Policy-
//   Report-Only first and watch the browser console for violations, then unset to enforce.
const cspOrigin = (u) => { try { return new URL(u).origin; } catch { return null; } };
const SUPABASE = cspOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);              // https://<ref>.supabase.co
const SUPABASE_WSS = SUPABASE ? SUPABASE.replace(/^https:/, "wss:") : null;    // Realtime
const UMAMI = cspOrigin(process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL);            // self-hosted analytics
const SENTRY = cspOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN);                 // ingest host from the DSN
const TURNSTILE = "https://challenges.cloudflare.com";
const R2 = "https://*.r2.cloudflarestorage.com";
const WEB3FORMS = "https://api.web3forms.com";
const uniq = (arr) => [...new Set(arr.filter(Boolean))].join(" ");

const CSP = [
  "default-src 'self'",
  `script-src ${uniq(["'self'", "'unsafe-inline'", TURNSTILE, UMAMI])}`,
  `style-src ${uniq(["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"])}`,
  `img-src ${uniq(["'self'", "data:", "blob:", "https:"])}`,
  `font-src ${uniq(["'self'", "data:", "https://fonts.gstatic.com"])}`,
  `connect-src ${uniq(["'self'", SUPABASE, SUPABASE_WSS, SENTRY, "https://*.ingest.sentry.io", "https://*.ingest.us.sentry.io", UMAMI, R2, TURNSTILE, WEB3FORMS])}`,
  `frame-src ${uniq(["'self'", "blob:", TURNSTILE])}`,
  `worker-src ${uniq(["'self'", "blob:"])}`,
  "manifest-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://api.web3forms.com",
].join("; ");

const CSP_HEADER_KEY =
  process.env.CSP_REPORT_ONLY === "1" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";

const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: CSP_HEADER_KEY, value: CSP },
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
