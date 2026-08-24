import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { heartbeat } from "@/lib/heartbeat";

export const runtime = "nodejs";

// Weekly cron (see vercel.json): nudge *engaged-but-stalling* interns — ≥1 submission ever, but nothing in
// the last STALE_DAYS — so fade-outs don't become drop-outs. Gated by the `re_engagement` flag; de-duped
// via re_engagement_nudges (migration 090) to at most one nudge per intern per DEDUP_DAYS. Service role.
const STALE_DAYS = 14;
const DEDUP_DAYS = 7;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const qsSecret = new URL(req.url).searchParams.get("secret");
  return auth === `Bearer ${secret}` || qsSecret === secret;
}

export async function GET(req) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Service role not configured" }, { status: 503 });
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Ships dark: only runs when the founder enables the flag (this cron SENDS EMAIL).
  const { data: flag } = await sb.from("feature_flags").select("enabled").eq("key", "re_engagement").maybeSingle();
  if (!flag?.enabled) { await heartbeat("HC_REENGAGEMENT_URL"); return NextResponse.json({ ok: true, skipped: "flag off" }); }

  const { data: students } = await sb.from("profiles").select("id,email,display_name,full_name")
    .eq("status", "approved").eq("is_alumni", false).eq("role", "student");
  if (!students?.length) { await heartbeat("HC_REENGAGEMENT_URL"); return NextResponse.json({ ok: true, sent: 0 }); }
  const ids = students.map((s) => s.id);

  const staleBefore = Date.now() - STALE_DAYS * 86400 * 1000;
  const dedupSince = new Date(Date.now() - DEDUP_DAYS * 86400 * 1000).toISOString().slice(0, 10);

  const [{ data: subs }, { data: recent }] = await Promise.all([
    sb.from("submissions").select("user_id,created_at").in("user_id", ids),
    sb.from("re_engagement_nudges").select("user_id").in("user_id", ids).gte("sent_on", dedupSince),
  ]);

  const latest = new Map(); // user_id -> latest submission ms
  for (const s of subs || []) {
    const t = s.created_at ? new Date(s.created_at).getTime() : 0;
    if (!latest.has(s.user_id) || t > latest.get(s.user_id)) latest.set(s.user_id, t);
  }
  const nudgedRecently = new Set((recent || []).map((r) => r.user_id));

  let sent = 0;
  for (const s of students) {
    if (!s.email || nudgedRecently.has(s.id)) continue;
    const last = latest.get(s.id);
    if (last == null) continue;         // never submitted — onboarding, not re-engagement
    if (last >= staleBefore) continue;  // submitted recently — still engaged
    const first = (s.full_name || s.display_name || "there").trim().split(/\s+/)[0] || "there";
    const subject = "Still with us? — ZeroDay Reapers";
    const html = `<p>Hi ${first},</p><p>We noticed it's been a little while since your last submission. You've already started — don't let the streak fade. A focused session this week keeps you on track for your certificate.</p><p>Log in to the portal to pick up where you left off. Stuck? Reply to this email or message an admin.</p><p>— ZeroDay Reapers</p>`;
    const r = await sendEmail(s.email, subject, html);
    if (r.ok) { await sb.from("re_engagement_nudges").insert({ user_id: s.id }); sent++; }
  }
  await heartbeat("HC_REENGAGEMENT_URL");
  return NextResponse.json({ ok: true, sent });
}
