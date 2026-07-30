import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { deleteByPrefix, r2Configured } from "@/lib/r2";

export const runtime = "nodejs";

// Founder-only full portal reset. Purges submissions + task-PDF objects from R2 FIRST (Postgres
// can't reach R2, and the DB keys vanish once reset_portal runs), then runs the DB reset RPC.
// Intentionally LEAVES documents/, avatars, payment/, and certificates/ in R2 intact.
export async function POST(req) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: prof } = await sb.from("profiles").select("is_founder").eq("id", user.id).single();
  if (!prof?.is_founder) return NextResponse.json({ error: "Only a founder can reset the portal." }, { status: 403 });

  // 1) Purge R2: submissions (student uploads + version history) + task PDFs. Best-effort.
  let deleted = 0;
  if (r2Configured) {
    try { deleted += await deleteByPrefix("submissions/"); } catch (e) { /* keep going — DB reset still runs */ }
    try { deleted += await deleteByPrefix("tasks/"); } catch (e) { /* keep going */ }
  }

  // 2) DB reset (the RPC re-checks is_founder via auth.uid()).
  const { error } = await sb.rpc("reset_portal");
  if (error) return NextResponse.json({ error: error.message, r2Deleted: deleted }, { status: 500 });

  return NextResponse.json({ ok: true, r2Deleted: deleted });
}
