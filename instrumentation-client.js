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
    // Drop noise that isn't our code — browser extensions / injected third-party scripts throw into the
    // page's global handlers and Sentry attributes them to us. None of our bundles are served from these
    // schemes (ours are https .../_next/...), so denying them only removes false positives.
    ignoreErrors: [
      // A browser extension throws this — "M_ID" is not a property used anywhere in our code.
      /Cannot read properties of undefined \(reading 'M_ID'\)/,
      /ResizeObserver loop (limit exceeded|completed)/,
      /Non-Error promise rejection captured/,
    ],
    denyUrls: [
      /^app:\/\//i,                    // injected/extension scheme (e.g. app://executors/200.js)
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
      /^safari-(web-)?extension:\/\//i,
      /\/executors\//i,
    ],
  });
}

// Instruments client-side navigations for tracing (a no-op if Sentry wasn't initialised).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
