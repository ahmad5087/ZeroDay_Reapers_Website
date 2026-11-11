import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { copyObject, deleteObject, r2Configured, rateLimit } from "@/lib/r2";

export const runtime = "nodejs";

// Promote a CV attached during signup (stored at a random signup/<uuid>.pdf key, recorded in
// profiles.cv_key) into the member's own Documents: copy it to documents/<uid>/resume.pdf, add a
// `documents` resume row, retire the signup object, and repoint profiles.cv_key at the final key.
// Called (best-effort) when the member first opens their Documents tab — the earliest point a
// logged-in session exists, since the CV is uploaded pre-auth at signup. Idempotent: once cv_key no
// longer starts with "signup/", it no-ops. All DB writes go through the member's own JWT (RLS-scoped
// to their rows); only the R2 copy/delete use the server credentials.
export async function POST(req) {
  if (!r2Configured) return NextResponse.json({ error: "Storage not configured" }, { status: 503 });

  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit("claim-cv:" + user.id, { limit: 10, windowMs: 60_000 }))
    return NextResponse.json({ error: "Too many requests — slow down." }, { status: 429 });

  const { data: profRows } = await sb.from("profiles").select("cv_key, cv_name").eq("id", user.id).limit(1);
  const prof = profRows?.[0];
  const cvKey = prof?.cv_key || "";
  if (!cvKey.startsWith("signup/")) return NextResponse.json({ claimed: false });

  // If they already have a resume (e.g. uploaded one before this ran), keep it and just retire the
  // signup pointer + its orphaned object — never clobber a resume they chose themselves.
  const { data: existingRows } = await sb.from("documents")
    .select("file_key, file_name").eq("user_id", user.id).eq("kind", "resume").limit(1);
  const existing = existingRows?.[0];
  if (existing) {
    await deleteObject(cvKey).catch(() => {});
    await sb.from("profiles").update({ cv_key: existing.file_key, cv_name: existing.file_name }).eq("id", user.id);
    return NextResponse.json({ claimed: false });
  }

  const destKey = `documents/${user.id}/resume.pdf`;
  await copyObject(cvKey, destKey);
  const { error: insErr } = await sb.from("documents")
    .insert({ user_id: user.id, kind: "resume", file_key: destKey, file_name: prof.cv_name || "cv.pdf" });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
  await deleteObject(cvKey).catch(() => {});
  await sb.from("profiles").update({ cv_key: destKey }).eq("id", user.id);
  return NextResponse.json({ claimed: true });
}
