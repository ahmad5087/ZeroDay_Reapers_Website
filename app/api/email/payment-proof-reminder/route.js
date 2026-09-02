import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { emailConfigured, sendEmail } from "@/lib/email";

export const runtime = "nodejs";

const SUBJECT = "Urgent: Final deadline to submit your internship fee proof";
const ALLOWED_GRACE_HOURS = new Set([24, 48]);
const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_RECIPIENTS = 2000;

const esc = (value = "") =>
  String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

function adminClient(token) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getAdmin(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const sb = adminClient(token);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return null;

  const { data: profile } = await sb.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return null;

  return { sb };
}

function deadlineLabel(deadline) {
  return `${new Intl.DateTimeFormat("en-PK", {
    timeZone: "Asia/Karachi",
    dateStyle: "full",
    timeStyle: "short",
  }).format(deadline)} PKT`;
}

function reminderHtml(firstName, graceHours, deadline) {
  const name = esc(firstName || "there");
  const deadlineText = esc(deadlineLabel(deadline));

  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:600px;margin:0 auto;color:#171717;line-height:1.65">
    <div style="background:#050505;padding:20px 24px;border-radius:10px 10px 0 0">
      <span style="font-family:Consolas,monospace;letter-spacing:2px;color:#fff;font-size:14px">ZERO<span style="color:#e10600">DAY</span> REAPERS</span>
    </div>
    <div style="border:1px solid #e5e5e5;border-top:0;border-radius:0 0 10px 10px;padding:24px">
      <p>Hi ${name},</p>
      <p>Our records show that we still have not received your internship fee payment proof. The original deadline was the end of Week 3.</p>
      <p style="background:#fff7ed;border-left:4px solid #f59e0b;padding:12px 14px">
        As a final courtesy, you have <strong>${graceHours} hours from this email</strong>, until <strong>${deadlineText}</strong>, to complete the payment and upload valid proof in <strong>Portal → Profile</strong>.
      </p>
      <p>After this grace period, accounts that still have no payment proof will be automatically removed by the portal's enforcement agent, without another individual warning or a separate manual review for each account.</p>
      <p>Because the requirement and original deadline were communicated at the start of the internship, the administration cannot guarantee reinstatement or accept responsibility for access removed because proof was not submitted on time.</p>
      <p>If you have already paid, upload the proof immediately. If you believe this notice is incorrect, reply before the grace period ends.</p>
      <p>Regards,<br>ZeroDay Reapers</p>
    </div>
  </div>`;
}

export async function POST(req) {
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!emailConfigured()) return NextResponse.json({ error: "Email is not configured" }, { status: 503 });

  const body = await req.json().catch(() => ({}));
  const graceHours = Number(body.graceHours);
  if (!ALLOWED_GRACE_HOURS.has(graceHours)) {
    return NextResponse.json({ error: "graceHours must be 24 or 48" }, { status: 400 });
  }
  if (!Array.isArray(body.recipientIds) || body.recipientIds.length === 0 || body.recipientIds.length > MAX_RECIPIENTS) {
    return NextResponse.json({ error: `recipientIds must contain between 1 and ${MAX_RECIPIENTS} profile IDs` }, { status: 400 });
  }

  const recipientIds = [...new Set(body.recipientIds)];
  if (recipientIds.some((id) => typeof id !== "string" || !PROFILE_ID_PATTERN.test(id))) {
    return NextResponse.json({ error: "recipientIds contains an invalid profile ID" }, { status: 400 });
  }

  // Recheck eligibility at send time, then intersect it with the admin's explicit selection. A
  // last-minute upload is never emailed, and members excluded in the preview cannot be added back.
  const { data, error } = await admin.sb
    .from("profiles")
    .select("id,email,display_name,full_name")
    .neq("role", "admin")
    .is("payment_proof_url", null)
    .not("email", "is", null)
    .limit(MAX_RECIPIENTS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const selectedIds = new Set(recipientIds);
  const eligibleRecipients = (data || []).filter((row) => row.email);
  const recipients = eligibleRecipients.filter((row) => selectedIds.has(row.id));
  if (recipients.length === 0) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      total: 0,
      requested: recipientIds.length,
      excluded: eligibleRecipients.length,
    });
  }

  const deadline = new Date(Date.now() + graceHours * 60 * 60 * 1000);
  let sent = 0;
  const concurrency = 4;
  for (let i = 0; i < recipients.length; i += concurrency) {
    const batch = recipients.slice(i, i + concurrency);
    const results = await Promise.all(batch.map((recipient) => {
      const firstName = (recipient.full_name || recipient.display_name || "there").trim().split(/\s+/)[0];
      return sendEmail(recipient.email, SUBJECT, reminderHtml(firstName, graceHours, deadline));
    }));
    sent += results.filter((result) => result.ok).length;
  }

  const total = recipients.length;
  const failed = total - sent;
  await admin.sb.rpc("log_admin_action", {
    p_action: "email_payment_proof_reminder",
    p_target: null,
    p_detail: `grace=${graceHours}h requested=${recipientIds.length} recipients=${total} excluded=${eligibleRecipients.length - total} sent=${sent} failed=${failed}`,
  });

  return NextResponse.json({
    ok: failed === 0,
    ...(failed === total && { error: "All reminder emails failed to send" }),
    subject: SUBJECT,
    graceHours,
    deadline: deadline.toISOString(),
    sent,
    failed,
    total,
    requested: recipientIds.length,
    excluded: eligibleRecipients.length - total,
  }, { status: failed === total ? 502 : 200 });
}
