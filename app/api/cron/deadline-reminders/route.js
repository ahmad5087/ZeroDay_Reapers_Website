import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

// Daily cron (see vercel.json): email students whose task is due within WINDOW_HOURS and who
// haven't submitted yet. De-duplicated via task_deadline_reminders (migration 024) so each
// student is reminded at most once per task. Runs with the service role (bypasses RLS).
const WINDOW_HOURS = 48;

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

  const now = Date.now();
  const windowEndMs = now + WINDOW_HOURS * 3600 * 1000;
  const nowIso = new Date(now).toISOString();
  const windowEndIso = new Date(windowEndMs).toISOString();

  const { data: tasks } = await sb.from("tasks")
    .select("id,week,title,due_at,domain_id,ram")
    .not("due_at", "is", null).gte("due_at", nowIso).lte("due_at", windowEndIso);

  let sent = 0;
  for (const task of tasks || []) {
    let q = sb.from("profiles").select("id,email")
      .eq("status", "approved").eq("is_alumni", false).eq("role", "student");
    if (task.domain_id != null) q = q.eq("domain_id", task.domain_id);
    if (task.ram != null) q = q.eq("ram", task.ram);
    const { data: students } = await q;
    if (!students?.length) continue;

    const ids = students.map((s) => s.id);
    const [{ data: submitted }, { data: reminded }, { data: exts }] = await Promise.all([
      sb.from("submissions").select("user_id").eq("task_id", task.id).in("user_id", ids),
      sb.from("task_deadline_reminders").select("user_id").eq("task_id", task.id).in("user_id", ids),
      sb.from("task_extension_requests").select("user_id,extended_until,status")
        .eq("task_id", task.id).eq("status", "approved").in("user_id", ids),
    ]);
    const done = new Set((submitted || []).map((r) => r.user_id));
    const already = new Set((reminded || []).map((r) => r.user_id));
    // Students granted an extension past the reminder window still have time — skip them.
    const extended = new Set((exts || [])
      .filter((r) => r.extended_until && new Date(r.extended_until).getTime() > windowEndMs)
      .map((r) => r.user_id));

    const targets = students.filter((s) => s.email && !done.has(s.id) && !already.has(s.id) && !extended.has(s.id));
    for (const s of targets) {
      const subject = `Reminder: Week ${task.week} task due soon — ZeroDay Reapers`;
      const html = `<p>Hi,</p><p>Your <b>Week ${task.week}</b> task “${task.title}” is due <b>${new Date(task.due_at).toLocaleString()}</b> and we haven't received your submission yet.</p><p>Log in to the portal to submit before the deadline.</p><p>— ZeroDay Reapers</p>`;
      const r = await sendEmail(s.email, subject, html);
      if (r.ok) {
        await sb.from("task_deadline_reminders").insert({ task_id: task.id, user_id: s.id });
        sent++;
      }
    }
  }
  return NextResponse.json({ ok: true, sent });
}
