import { NextResponse } from "next/server";
import { emailConfigured, sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/r2";

export const runtime = "nodejs";

// Failed-login alerting (audit finding F3). The login form POSTs here (best-effort, fire-and-forget)
// whenever a password sign-in is rejected for bad credentials. When the same email+IP crosses a
// threshold inside a short window, the founder gets ONE alert email (then a cooldown suppresses repeats).
//
// Scope + limits: this only sees failures that go through our login form, so it catches UI brute-forcing,
// not an attacker hitting the Supabase Auth API directly (airtight coverage needs a Supabase Auth Hook /
// log drain configured in the dashboard). Counting is in-memory per serverless instance, so it can
// under-count across instances — acceptable for an alert (it errs toward fewer false alarms). To receive
// alerts, set SECURITY_ALERT_EMAIL (falls back to RESEND_REPLY_TO) and RESEND_API_KEY; otherwise this is
// a silent no-op.

const WINDOW_MS = 15 * 60_000;      // failures counted within this window
const THRESHOLD = 5;                // failures before the first alert fires
const ALERT_COOLDOWN_MS = 30 * 60_000; // min gap between alerts for the same email+IP

const attempts = new Map(); // "email|ip" -> { hits: number[], alertedAt: number }

function prune() {
  if (attempts.size <= 5000) return;
  for (const k of attempts.keys()) { attempts.delete(k); if (attempts.size <= 2500) break; }
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export async function POST(req) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  // Throttle the endpoint itself so it can never be used to spam the founder with alert mail.
  if (!rateLimit(`failed-login:${ip}`, { limit: 20, windowMs: 60_000 }))
    return NextResponse.json({ ok: true });

  const { email } = await req.json().catch(() => ({}));
  const addr = typeof email === "string" ? email.trim().toLowerCase().slice(0, 120) : "";
  if (!addr) return NextResponse.json({ ok: true });

  const now = Date.now();
  const key = `${addr}|${ip}`;
  const rec = attempts.get(key) || { hits: [], alertedAt: 0 };
  rec.hits = rec.hits.filter((t) => now - t < WINDOW_MS);
  rec.hits.push(now);

  const alertTo = process.env.SECURITY_ALERT_EMAIL || process.env.RESEND_REPLY_TO;
  if (rec.hits.length >= THRESHOLD && now - rec.alertedAt > ALERT_COOLDOWN_MS && emailConfigured() && alertTo) {
    rec.alertedAt = now;
    const html =
      `<div style="font-family:system-ui,Arial,sans-serif;line-height:1.6;color:#111">` +
      `<h2 style="margin:0 0 8px">⚠️ Repeated failed logins</h2>` +
      `<p><b>${rec.hits.length}</b> failed sign-in attempts in the last ${WINDOW_MS / 60000} minutes.</p>` +
      `<ul>` +
      `<li><b>Account:</b> ${esc(addr)}</li>` +
      `<li><b>Source IP:</b> ${esc(ip)}</li>` +
      `<li><b>Time:</b> ${new Date(now).toUTCString()}</li>` +
      `</ul>` +
      `<p style="color:#666;font-size:13px">If this wasn't you or a known user mistyping, consider resetting that account's password. ` +
      `Login is already protected by Turnstile + Supabase rate limiting; this is an early-warning signal from the portal login form only.</p>` +
      `</div>`;
    sendEmail(alertTo, `⚠️ ZeroDay Reapers: repeated failed logins for ${addr}`, html).catch(() => {});
  }
  attempts.set(key, rec);
  prune();
  return NextResponse.json({ ok: true });
}
