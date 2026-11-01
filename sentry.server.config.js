// Sentry server (Node runtime) init. Loaded from instrumentation.js's register().
// Gated behind NEXT_PUBLIC_SENTRY_DSN — no DSN means Sentry is never initialised (full no-op).
import * as Sentry from "@sentry/nextjs";
import { SENTRY_DATA_COLLECTION } from "./lib/sentry-data-collection";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // Keep v10's restrictive PII posture under SDK v11 (see ./lib/sentry-data-collection).
    dataCollection: SENTRY_DATA_COLLECTION,
  });
}
