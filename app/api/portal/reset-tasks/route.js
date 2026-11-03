import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deleteObject, r2Configured } from "@/lib/r2";

export const runtime = "nodejs";

// Founder-only, cohort-scoped task reset. Deletes every published task for ONE cohort plus its
// submissions / version history (DB rows cascade from the tasks delete). Purges the matching R2 objects
// FIRST — Postgres can't reach R2, and the keys vanish once reset_cohort_tasks() runs. Unlike the full
// portal reset, this can't use deleteByPrefix (that prefix spans every cohort), so it deletes the exact
// task-PDF + submission keys for this cohort only. Other cohorts are untouched.
export async function POST(req) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: prof } = await sb.from("profiles").select("is_founder").eq("id", user.id).single();
  if (!prof?.is_founder) return NextResponse.json({ error: "Only a founder can reset a cohort's tasks." }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const cohort = Number(body?.cohort);
  if (!Number.isInteger(cohort) || cohort < 1 || cohort > 99) {
    return NextResponse.json({ error: "A cohort between 1 and 99 is required." }, { status: 400 });
  }

  // 1) Collect this cohort's R2 keys (admin RLS lets a founder read every row): task PDFs +
  //    current submissions + version-history files. Purge them best-effort before the DB delete.
  let r2Deleted = 0;
  const { data: tasks } = await sb.from("tasks").select("id, file_path").eq("cohort", cohort);
  const taskIds = (tasks || []).map((t) => t.id);
  const keys = new Set((tasks || []).map((t) => t.file_path).filter(Boolean));

  if (taskIds.length) {
    const { data: subs } = await sb.from("submissions").select("file_path").in("task_id", taskIds);
    (subs || []).forEach((s) => { if (s.file_path) keys.add(s.file_path); });
    const { data: vers } = await sb.from("submission_files").select("file_path").in("task_id", taskIds);
    (vers || []).forEach((v) => { if (v.file_path) keys.add(v.file_path); });
  }

  if (r2Configured && keys.size) {
    const results = await Promise.allSettled([...keys].map((k) => deleteObject(k)));
    r2Deleted = results.filter((r) => r.status === "fulfilled").length;
  }

  // 2) DB reset (the RPC re-checks is_founder via auth.uid(); child rows cascade from tasks).
  const { data: tasksDeleted, error } = await sb.rpc("reset_cohort_tasks", { p_cohort: cohort });
  if (error) {
    const msg = error.message?.includes("function")
      ? "Task reset isn't ready — run migration 120_tasks_per_cohort.sql in Supabase."
      : error.message;
    return NextResponse.json({ error: msg, r2Deleted }, { status: 500 });
  }

  return NextResponse.json({ ok: true, cohort, tasksDeleted: tasksDeleted ?? 0, r2Deleted });
}
