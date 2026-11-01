// Pin Sentry's automatic data collection to the v10-equivalent RESTRICTIVE baseline.
//
// Sentry SDK v11 changed the default: with `dataCollection` left unset it now collects user PII
// by default — IP address, cookies, HTTP request/response bodies, database query data, GenAI
// inputs/outputs and queue arguments. In v10 (with `sendDefaultPii` unset) none of that was sent.
// We only want diagnostic data in Sentry (see the /privacy page), so we restore the v10 behavior
// explicitly on every runtime (node, edge, browser). Values below mirror the "Keeping the v10
// collection defaults" snippet from the Sentry v10->v11 Next.js migration guide, plus `queues:false`.
//
// To intentionally collect more later, relax a specific field here — don't drop the whole object.
export const SENTRY_DATA_COLLECTION = {
  userInfo: false, // no user.ip_address / id / email / username inference
  cookies: false,
  httpHeaders: {
    request: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
    response: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
  },
  httpBodies: [], // never send request/response bodies (they contain user content)
  urlQueryParams: { deny: ["forwarded", "-ip", "remote-", "via", "-user"] },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  graphQL: { document: false, variables: false },
  queues: false,
};
