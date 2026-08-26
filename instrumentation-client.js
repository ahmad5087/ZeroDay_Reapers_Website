// Sentry browser init (Next.js client instrumentation hook).
// Fully gated behind NEXT_PUBLIC_SENTRY_DSN: with no DSN set, Sentry.init is never called and
// the SDK stays a complete no-op. To move to self-hosted GlitchTip later, just point
// NEXT_PUBLIC_SENTRY_DSN at the GlitchTip DSN — GlitchTip is Sentry-compatible, so no code change.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    // Quota-friendly defaults; raise later if you want more performance data.
    tracesSampleRate: 0.1,
  });
}

// Instruments client-side navigations for tracing (a no-op if Sentry wasn't initialised).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
