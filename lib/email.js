// Server-side email via Resend. Safe to call unconditionally: if RESEND_API_KEY isn't set,
// every send is silently skipped (returns { skipped: true }) so callers never need to guard.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || "ZeroDay Reapers <onboarding@resend.dev>";
const REPLY_TO = process.env.RESEND_REPLY_TO; // optional

// Resend rate limits are team-wide. Pace every request made by this server instance below the
// provider limit, leaving headroom for authentication, cron, and other transactional emails.
// A 429 can still happen when another server instance/key uses the same team quota, so retry it
// using Resend's response headers instead of dropping that recipient.
const configuredRequestsPerSecond = Number.parseInt(process.env.RESEND_REQUESTS_PER_SECOND || "", 10);
const REQUESTS_PER_SECOND = Number.isFinite(configuredRequestsPerSecond)
  ? Math.max(1, Math.min(configuredRequestsPerSecond, 20))
  : 4;
const MIN_REQUEST_INTERVAL_MS = Math.ceil(1000 / REQUESTS_PER_SECOND);
const MAX_RATE_LIMIT_ATTEMPTS = 5;

let requestQueue = Promise.resolve();
let nextRequestAt = 0;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function headerDelayMs(response, name) {
  const seconds = Number.parseFloat(response.headers.get(name) || "");
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  // Add a small boundary cushion so the retry does not land in the same provider window.
  return Math.max(MIN_REQUEST_INTERVAL_MS, Math.ceil(seconds * 1000) + 100);
}

function enqueueRequest(task) {
  const run = async () => {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs) await sleep(waitMs);
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
    return task();
  };

  const result = requestQueue.then(run, run);
  requestQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function resendRequest(payload, attempt) {
  return enqueueRequest(async () => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: payload,
    });

    if (response.status === 429) {
      const retryMs = headerDelayMs(response, "retry-after")
        || headerDelayMs(response, "ratelimit-reset")
        || Math.min(10_000, 1000 * (2 ** attempt));
      nextRequestAt = Math.max(nextRequestAt, Date.now() + retryMs);
    } else {
      const remaining = Number.parseInt(response.headers.get("ratelimit-remaining") || "", 10);
      if (remaining === 0) {
        const resetMs = headerDelayMs(response, "ratelimit-reset");
        if (resetMs) nextRequestAt = Math.max(nextRequestAt, Date.now() + resetMs);
      }
    }

    return response;
  });
}

export function emailConfigured() {
  return Boolean(RESEND_API_KEY);
}

export async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY || !to) return { ok: false, skipped: true };
  try {
    const payload = JSON.stringify({ from: FROM, to, subject, html, ...(REPLY_TO && { reply_to: REPLY_TO }) });
    for (let attempt = 0; attempt < MAX_RATE_LIMIT_ATTEMPTS; attempt++) {
      const response = await resendRequest(payload, attempt);
      if (response.status === 429 && attempt + 1 < MAX_RATE_LIMIT_ATTEMPTS) continue;
      return { ok: response.ok, status: response.status, rateLimited: response.status === 429 };
    }
    return { ok: false, rateLimited: true };
  } catch {
    return { ok: false };
  }
}

// Best-effort fan-out. Sends individually (no shared To:) so recipient addresses are never exposed
// to each other; the shared queue above applies the actual request-per-second cap.
export async function sendBulk(recipients, subject, html, { concurrency = 4 } = {}) {
  const list = (recipients || []).filter(Boolean);
  if (!RESEND_API_KEY) return { sent: 0, total: list.length, skipped: true };
  let sent = 0;
  for (let i = 0; i < list.length; i += concurrency) {
    const batch = list.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((to) => sendEmail(to, subject, html)));
    sent += results.filter((r) => r.ok).length;
  }
  return { sent, total: list.length };
}
