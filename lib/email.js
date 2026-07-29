// Server-side email via Resend. Safe to call unconditionally: if RESEND_API_KEY isn't set,
// every send is silently skipped (returns { skipped: true }) so callers never need to guard.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || "ZeroDay Reapers <onboarding@resend.dev>";
const REPLY_TO = process.env.RESEND_REPLY_TO; // optional

export function emailConfigured() {
  return Boolean(RESEND_API_KEY);
}

export async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY || !to) return { ok: false, skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html, ...(REPLY_TO && { reply_to: REPLY_TO }) }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

// Best-effort fan-out with small concurrency. Sends individually (no shared To:) so recipient
// addresses are never exposed to each other.
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
