import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendBulk, emailConfigured } from "@/lib/email";

export const runtime = "nodejs";

// Releases tasks that were scheduled for a future time (migration 130). Visibility is already handled
// instantly by RLS (tasks_read: publish_at <= now()), so this job only fires the DEFERRED "now live"
// announcement + email — exactly once per task (announced_at guard) — mirroring the immediate publish
// path in AdminPanel.createTask. Runs on a schedule (see vercel.json). Service role → bypasses RLS.
//
// Note: the task becomes VISIBLE to interns the moment publish_at passes (database-enforced, no cron).
// This cron only sends the notification, so its cadence affects when the email/announcement arrives,
// not when the task appears.
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

  const nowIso = new Date().toISOString();

  // Tasks whose scheduled release time has arrived but whose announcement hasn't been sent yet.
  const { data: due, error } = await sb.from("tasks")
    .select("id,week,title,domain_id,ram,created_by")
    .not("publish_at", "is", null)
    .lte("publish_at", nowIso)
    .is("announced_at", null)
    .order("publish_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!due?.length) return NextResponse.json({ ok: true, released: 0, emailed: 0 });

  // Fallback poster for a domain-chat announcement when a task has no created_by (e.g. legacy rows).
  let fallbackPoster = null;
  if (due.some((t) => t.domain_id != null && !t.created_by)) {
    const { data: f } = await sb.from("profiles").select("id").eq("is_founder", true).limit(1).maybeSingle();
    fallbackPoster = f?.id || null;
  }

  let released = 0;
  let emailed = 0;
  for (const t of due) {
    // 1) In-portal announcement: a domain-chat message for a department task, else a global announcement.
    if (t.domain_id != null) {
      const poster = t.created_by || fallbackPoster;
      if (poster) {
        await sb.from("messages").insert({
          domain_id: t.domain_id,
          user_id: poster,
          content: `📢 ANNOUNCEMENT: Week ${t.week} Task is now live — "${t.title}". Head over to your Tasks tab to download the attached PDF instructions and submit your deliverable!`,
        });
      }
    } else {
      await sb.from("announcements").insert({
        title: `Week ${t.week} Task: ${t.title}`,
        body: `A new task for Week ${t.week} has been published for all departments. Check your Tasks tab to download the PDF instructions and submit your deliverable!`,
      });
    }

    // 2) Mark announced BEFORE emailing so a retry can never double-post the announcement.
    await sb.from("tasks").update({ announced_at: new Date().toISOString() }).eq("id", t.id);
    released++;

    // 3) Best-effort "now live" email to the same audience as the immediate path: approved, non-alumni
    //    students in the task's domain + RAM. No-ops when Resend isn't configured.
    if (emailConfigured()) {
      let q = sb.from("profiles").select("email")
        .eq("status", "approved").eq("is_alumni", false).eq("role", "student");
      if (t.domain_id != null) q = q.eq("domain_id", t.domain_id);
      if (t.ram != null) q = q.eq("ram", t.ram);
      const { data: students } = await q.limit(2000);
      const emails = (students || []).map((s) => s.email).filter(Boolean);
      if (emails.length) {
        await sendBulk(
          emails,
          `New task assigned — Week ${t.week} — ZeroDay Reapers`,
          `<p>A new task has been assigned: <b>Week ${t.week} · ${t.title}</b>.</p><p>Log in to the portal Tasks tab to view the instructions and submit your deliverable.</p>`
        );
        emailed += emails.length;
      }
    }
  }

  return NextResponse.json({ ok: true, released, emailed });
}
