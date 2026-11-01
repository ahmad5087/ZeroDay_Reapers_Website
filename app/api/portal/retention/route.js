import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deleteByPrefix, r2Configured } from "@/lib/r2";

export const runtime = "nodejs";

// Founder-only cohort data-retention cleanup (see supabase/109_cohort_data_retention.sql).
// Defaults to a DRY RUN that only reports what WOULD change. A real purge requires
// { dry_run: false, confirm: "PURGE-COHORT" }. The DB RPC re-checks is_founder, that the cohort is
// fully graduated, and that the 15-day window has elapsed — it raises otherwise, so nothing is removed.
//
// Cohort 1 default cutoff: members signed up before Cohort 2 began (1 Oct 2026). The DB keeps every
// grade (status/feedback/score_*); this route also deletes the matching R2 objects (the actual work).
const COHORT1_SIGNUP_BEFORE = "2026-10-01T00:00:00Z";
const CONFIRM_PHRASE = "PURGE-COHORT";

export async function POST(req) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: prof } = await sb.from("profiles").select("is_founder").eq("id", user.id).single();
  if (!prof?.is_founder) {
    return NextResponse.json({ error: "Only a founder can run cohort retention cleanup." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body.dry_run !== false; // default true — must explicitly send false to purge
  const signupBefore = body.signup_before || COHORT1_SIGNUP_BEFORE;
  const retainDays = Number.isInteger(body.retain_days) ? body.retain_days : 15;
  const anchor = body.anchor || null;

  if (!dryRun && body.confirm !== CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: `Refusing destructive run without confirm: "${CONFIRM_PHRASE}".` },
      { status: 400 }
    );
  }

  // Validate (founder + fully-graduated + 15-day window) and get target ids WITHOUT changing anything.
  const { data: preview, error: previewErr } = await sb.rpc("cleanup_cohort_intern_data", {
    p_signup_before: signupBefore,
    p_retain_days: retainDays,
    p_dry_run: true,
    p_anchor: anchor,
  });
  if (previewErr) {
    // Gate not met (not founder / cohort not graduated / window not elapsed) — nothing was touched.
    return NextResponse.json({ error: previewErr.message }, { status: 409 });
  }

  if (dryRun) {
    return NextResponse.json({ ok: true, dry_run: true, preview });
  }

  // Real run. 1) Purge R2 per target: submissions/{uid}/ (uploads + version history), documents/{uid}/,
  // and chat/{uid}/ (group-chat attachments the intern uploaded — keys are per-sender, see upload-url).
  // Leaves payment/, certificates/, avatars, dm/ intact. Best-effort (DB step still runs).
  const targetIds = Array.isArray(preview?.target_ids) ? preview.target_ids : [];
  let r2Deleted = 0;
  if (r2Configured) {
    for (const uid of targetIds) {
      try { r2Deleted += await deleteByPrefix(`submissions/${uid}/`); } catch { /* keep going */ }
      try { r2Deleted += await deleteByPrefix(`documents/${uid}/`); } catch { /* keep going */ }
      try { r2Deleted += await deleteByPrefix(`chat/${uid}/`); } catch { /* keep going */ }
    }
  }

  // 2) DB cleanup (strips work + free-text, deletes group messages + documents rows, keeps grades/DMs/profile).
  const { data: result, error } = await sb.rpc("cleanup_cohort_intern_data", {
    p_signup_before: signupBefore,
    p_retain_days: retainDays,
    p_dry_run: false,
    p_anchor: anchor,
  });
  if (error) return NextResponse.json({ error: error.message, r2Deleted }, { status: 500 });

  return NextResponse.json({ ok: true, dry_run: false, r2Deleted, result });
}
