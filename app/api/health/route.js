import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health check (Phase 15 — reliability). Coarse status of each dependency for the gatus monitor / a
// public status page — no secrets, no PII. 200 when healthy, 503 when a configured dependency is down.
// DB = a cheap reachability query; R2 = configured; email = Resend key present.
export async function GET() {
  const checks = {};

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) {
      checks.db = "unconfigured";
    } else {
      const sb = createClient(url, anon, { auth: { persistSession: false } });
      const { error } = await sb.from("feature_flags").select("key").limit(1);
      checks.db = error ? "error" : "ok";
    }
  } catch { checks.db = "error"; }

  checks.r2 = r2Configured ? "ok" : "unconfigured";
  checks.email = process.env.RESEND_API_KEY ? "ok" : "unconfigured";

  const ok = !Object.values(checks).includes("error");
  return NextResponse.json({ ok, checks, ts: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
