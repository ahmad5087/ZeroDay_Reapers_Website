import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { heartbeat } from "@/lib/heartbeat";

export const runtime = "nodejs";

// Weekly cohort digest (see vercel.json). For each active student, composes a personalized summary —
// upcoming deadlines, tasks needing changes, unfinished bookmarked resources, latest announcement —
// and delivers it as an email + an in-portal notification (migration 072). De-duplicated per ISO week
// via weekly_digest_log (migration 074). Runs with the service role (bypasses RLS). Gated by the
// `weekly_digest` feature flag so it no-ops until you turn it on.
const HORIZON_DAYS = 7;

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") || "";
  const qsSecret = new URL(req.url).searchParams.get("secret");
  return auth === `Bearer ${secret}` || qsSecret === secret;
}

function mondayUTC(d = new Date()) {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff))
    .toISOString().slice(0, 10);
}

export async function GET(req) {
  if (!authorized(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "Service role not configured" }, { status: 503 });
  const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Feature flag: skip entirely unless enabled.
  const { data: flag } = await sb.from("feature_flags").select("enabled").eq("key", "weekly_digest").maybeSingle();
  if (!flag?.enabled) { await heartbeat("HC_DIGEST_URL"); return NextResponse.json({ ok: true, skipped: "weekly_digest flag off", sent: 0 }); }

  const weekOf = mondayUTC();
  const now = Date.now();
  const horizon = now + HORIZON_DAYS * 86400 * 1000;

  const [{ data: students }, { data: tasks }, { data: subs }, { data: exts }, { data: sent }, { data: ann },
         { data: bookmarks }, { data: progress }, { data: resources }] = await Promise.all([
    sb.from("profiles").select("id,email,display_name,full_name,domain_id,ram")
      .eq("status", "approved").eq("is_alumni", false).eq("role", "student"),
    sb.from("tasks").select("id,week,title,due_at,domain_id,ram"),
    sb.from("submissions").select("user_id,task_id,status"),
    sb.from("task_extension_requests").select("user_id,task_id,extended_until,status").eq("status", "approved"),
    sb.from("weekly_digest_log").select("user_id").eq("week_of", weekOf),
    sb.from("announcements").select("title,created_at").order("created_at", { ascending: false }).limit(1),
    sb.from("resource_bookmarks").select("user_id,resource_id"),
    sb.from("resource_progress").select("user_id,resource_id"),
    sb.from("resources").select("id,title,is_published"),
  ]);

  const alreadySent = new Set((sent || []).map((r) => r.user_id));
  const subByUserTask = new Map((subs || []).map((s) => [`${s.user_id}:${s.task_id}`, s]));
  const extByUserTask = new Map((exts || []).filter((e) => e.extended_until).map((e) => [`${e.user_id}:${e.task_id}`, e.extended_until]));
  const rejectedByUser = new Map();
  for (const s of subs || []) if (s.status === "rejected") rejectedByUser.set(s.user_id, (rejectedByUser.get(s.user_id) || 0) + 1);
  const resTitle = new Map((resources || []).filter((r) => r.is_published).map((r) => [r.id, r.title]));
  const progressSet = new Set((progress || []).map((p) => `${p.user_id}:${p.resource_id}`));
  const bookmarksByUser = new Map();
  for (const b of bookmarks || []) {
    if (!resTitle.has(b.resource_id)) continue;            // only published, still-existing resources
    if (progressSet.has(`${b.user_id}:${b.resource_id}`)) continue; // already completed
    const list = bookmarksByUser.get(b.user_id) || [];
    list.push(resTitle.get(b.resource_id));
    bookmarksByUser.set(b.user_id, list);
  }
  const latestAnn = (ann || [])[0] || null;

  let sentCount = 0;
  for (const st of students || []) {
    if (!st.email || alreadySent.has(st.id)) continue;
    try {
      const eligible = (tasks || []).filter((t) => (!t.domain_id || t.domain_id === st.domain_id) && (!t.ram || t.ram === st.ram));
      const upcoming = [];
      let overdue = 0;
      for (const t of eligible) {
        if (subByUserTask.has(`${st.id}:${t.id}`)) continue;
        const eff = extByUserTask.get(`${st.id}:${t.id}`) || t.due_at;
        if (!eff) continue;
        const ms = new Date(eff).getTime();
        if (ms < now) overdue++;
        else if (ms <= horizon) upcoming.push({ week: t.week, title: t.title, due: eff });
      }
      const needsChanges = rejectedByUser.get(st.id) || 0;
      const unfinished = bookmarksByUser.get(st.id) || [];

      if (upcoming.length === 0 && overdue === 0 && needsChanges === 0 && unfinished.length === 0) continue;

      const first = (st.full_name || st.display_name || "there").trim().split(/\s+/)[0];
      const parts = [];
      if (upcoming.length) parts.push(`<p><b>Upcoming deadlines (${upcoming.length}):</b><br>` +
        upcoming.map((u) => `Week ${u.week} · ${u.title} — due ${new Date(u.due).toLocaleString()}`).join("<br>") + `</p>`);
      if (overdue) parts.push(`<p style="color:#b5352c;"><b>${overdue}</b> task(s) overdue and not submitted.</p>`);
      if (needsChanges) parts.push(`<p><b>${needsChanges}</b> submission(s) need changes — revise and re-submit.</p>`);
      if (unfinished.length) parts.push(`<p><b>Saved resources to finish:</b><br>${unfinished.slice(0, 5).join("<br>")}</p>`);
      if (latestAnn) parts.push(`<p><b>Latest announcement:</b> ${latestAnn.title}</p>`);

      const subject = "Your ZeroDay Reapers weekly digest";
      const html = `<p>Hi ${first},</p><p>Here's where things stand this week:</p>${parts.join("")}` +
        `<p>Log in to the portal to act on these. — ZeroDay Reapers</p>`;

      const summary = [
        upcoming.length ? `${upcoming.length} upcoming` : null,
        overdue ? `${overdue} overdue` : null,
        needsChanges ? `${needsChanges} need changes` : null,
        unfinished.length ? `${unfinished.length} resources to finish` : null,
      ].filter(Boolean).join(" · ");

      const r = await sendEmail(st.email, subject, html);
      // In-portal Action Center entry regardless of email success (best-effort email).
      await sb.from("notifications").insert({ user_id: st.id, kind: "digest", title: "Weekly digest", body: summary || "Your weekly summary is ready." });
      // Log the week regardless of email outcome so a failed send can't re-notify next run.
      await sb.from("weekly_digest_log").insert({ user_id: st.id, week_of: weekOf });
      if (r?.ok) sentCount++;
    } catch { /* one student's failure shouldn't stop the run */ }
  }

  await heartbeat("HC_DIGEST_URL");
  return NextResponse.json({ ok: true, week_of: weekOf, sent: sentCount });
}
