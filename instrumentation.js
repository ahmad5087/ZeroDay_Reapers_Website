// Next.js server instrumentation hook. Wires Sentry for the Node and edge runtimes, and forwards
// server-side request errors (Server Components, route handlers) to Sentry via onRequestError.
// Everything is gated behind NEXT_PUBLIC_SENTRY_DSN so the app is completely unaffected when it's unset.

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(...args) {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
}
