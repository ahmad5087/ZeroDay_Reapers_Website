// Sentry edge runtime init (middleware / edge routes). Loaded from instrumentation.js's register().
// Gated behind NEXT_PUBLIC_SENTRY_DSN — no DSN means Sentry is never initialised (full no-op).
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}
