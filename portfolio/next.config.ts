import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Served under zerodayreapers.me/portfolio via rewrites from the main app.
  basePath: "/portfolio",
  // This app lives inside a larger repo. Pin Turbopack's root to this directory so it does
  // NOT infer the repo root (via the parent lockfile) and pull in the main app's root-level
  // instrumentation.js — that file imports @sentry/nextjs, which the portfolio doesn't
  // install, which breaks the portfolio's Vercel build.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default nextConfig;
