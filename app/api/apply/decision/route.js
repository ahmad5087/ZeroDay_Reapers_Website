import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

// Admin decision on a Cohort 2 application (Phase 12). Verifies the caller is an admin (Bearer token, same
// pattern as /api/notify), records decision + decided_at + decided_by on the waitlist row (admin RLS from
// 088/097), then emails the applicant — an acceptance OR a rejection, both branded. Email is best-effort:
// the decision is saved even if Resend is unset (emailed:false in the response). Reversible — an admin can
// change a decision and the applicant is re-emailed accordingly.

const COHORT_DATE = "1st October 2026";
const DISCORD_INVITE = process.env.NEXT_PUBLIC_DISCORD_INVITE || "https://discord.com/invite/JATEvx9FED";

function adminClient(token) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const esc = (v = "") =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function shell(inner) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#141414;line-height:1.6">
    <div style="background:#050505;padding:20px 24px;border-radius:10px 10px 0 0">
      <span style="font-family:Consolas,monospace;letter-spacing:2px;color:#fff;font-size:14px">ZERO<span style="color:#e10600">DAY</span> REAPERS</span>
    </div>
    <div style="border:1px solid #eee;border-top:0;border-radius:0 0 10px 10px;padding:24px">${inner}</div>
  </div>`;
}

function acceptEmail(first, domain) {
  const track = domain ? ` for the <b>${esc(domain)}</b> track` : "";
  return {
    subject: "🎯 You're in — ZeroDay Reapers Cohort 2",
    html: shell(
      `<p>Hi ${esc(first)},</p>
       <p><b>Congratulations — your application to Cohort 2 has been accepted${track}.</b></p>
       <p>Here's what to expect:</p>
       <ul style="padding-left:20px;margin:0 0 16px">
         <li>Cohort 2 begins <b>${COHORT_DATE}</b> — a 6-week remote, weekly task-based internship.</li>
         <li>A one-time registration fee of <b>PKR 1,000</b> is due <b>after Week 1</b>.</li>
         <li>The top student in each domain earns <b>1 month of TryHackMe Pro or HackTheBox Pro</b>.</li>
       </ul>
       <p>Next step: join our Discord so you're ready for onboarding —
         <a href="${esc(DISCORD_INVITE)}" style="color:#e10600">${esc(DISCORD_INVITE)}</a>.
         We'll send your start instructions before the cohort begins.</p>
       <p>Welcome aboard. 🔴<br>— ZeroDay Reapers</p>`
    ),
  };
}

function rejectEmail(first, domain) {
  const track = domain ? ` for the ${esc(domain)} track` : "";
  return {
    subject: "Your ZeroDay Reapers Cohort 2 application",
    html: shell(
      `<p>Hi ${esc(first)},</p>
       <p>Thank you for applying to Cohort 2${track} of the ZeroDay Reapers internship, and for the time you
          put into your application.</p>
       <p>After careful review, we're unable to offer you a place in this cohort. This was a competitive
          round and our spots are limited — it is not a reflection of your potential.</p>
       <p>We'd genuinely encourage you to keep building your skills and apply again for our next cohort.
          You're also welcome to join our community on Discord to learn alongside us:
          <a href="${esc(DISCORD_INVITE)}" style="color:#e10600">${esc(DISCORD_INVITE)}</a>.</p>
       <p>Wishing you the best,<br>— ZeroDay Reapers</p>`
    ),
  };
}

export async function POST(req) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const sb = adminClient(token);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
  if (prof?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, decision } = await req.json().catch(() => ({}));
  if (!id || !["accepted", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "id and decision (accepted|rejected) required" }, { status: 400 });
  }

  // Read the application (admin RLS allows).
  const { data: row } = await sb.from("waitlist").select("id, email, name, domain").eq("id", id).single();
  if (!row?.email) return NextResponse.json({ error: "Application not found" }, { status: 404 });

  // Record the decision.
  const { error: upErr } = await sb
    .from("waitlist")
    .update({ decision, decided_at: new Date().toISOString(), decided_by: user.id })
    .eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 502 });

  // Email the applicant (accept or reject).
  const first = (row.name || "there").trim().split(/\s+/)[0] || "there";
  const { subject, html } = decision === "accepted" ? acceptEmail(first, row.domain) : rejectEmail(first, row.domain);
  const r = await sendEmail(row.email, subject, html);

  return NextResponse.json({ ok: true, decision, emailed: !!r.ok });
}
