import { NextResponse } from "next/server";
import { r2Configured } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Health check (Phase 15 — reliability). Coarse status of each dependency for the gatus monitor / a
// public status page — no secrets, no PII. 200 when healthy, 503 when a configured dependency is down.
// DB/Auth = bounded live reachability probes; R2/email = configuration checks.
const DEPENDENCY_TIMEOUT_MS = 5_000;

async function probe(url, anon) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEPENDENCY_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      signal: controller.signal,
    });
    return response.ok ? "ok" : "error";
  } catch {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const checks = {};

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    checks.db = "unconfigured";
    checks.auth = "unconfigured";
  } else {
    [checks.db, checks.auth] = await Promise.all([
      probe(`${url}/rest/v1/feature_flags?select=key&limit=1`, anon),
      probe(`${url}/auth/v1/settings`, anon),
    ]);
  }

  checks.r2 = r2Configured ? "ok" : "unconfigured";
  checks.email = process.env.RESEND_API_KEY ? "ok" : "unconfigured";

  const ok = !Object.values(checks).includes("error");
  return NextResponse.json({ ok, checks, ts: new Date().toISOString() }, { status: ok ? 200 : 503 });
}
