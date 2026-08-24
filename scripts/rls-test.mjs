// RLS / authorization test suite (Phase 14 — security). Signs in as anon (and, if creds are provided,
// a test student) and asserts the row-level-security invariants that must never regress: the public
// can't read admin-only tables, anon-callable RPCs stay callable, and non-founders can't flip flags.
//
// Runs in CI (see .github/workflows/ci.yml). Point TEST_SUPABASE_* at a DISPOSABLE staging project,
// NEVER production. Skips (exit 0) until the secrets are configured.
//
//   node scripts/rls-test.mjs
//
// Env: TEST_SUPABASE_URL, TEST_SUPABASE_ANON_KEY, [TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD]

import { createClient } from "@supabase/supabase-js";

const URL = process.env.TEST_SUPABASE_URL;
const ANON = process.env.TEST_SUPABASE_ANON_KEY;

if (!URL || !ANON) {
  console.log("⏭  RLS tests skipped — set TEST_SUPABASE_URL / TEST_SUPABASE_ANON_KEY to run (docs/phases/PHASE-14-SECURITY.md).");
  process.exit(0);
}

let failures = 0;
function check(name, ok, detail = "") {
  if (ok) { console.log(`  ✓ ${name}`); }
  else { failures++; console.error(`  ✗ ${name}${detail ? " — " + detail : ""}`); }
}

// A table is "not readable" if RLS hides every row (empty) or denies outright (error).
async function notReadable(client, table) {
  const { data, error } = await client.from(table).select("*").limit(1);
  const hidden = (!error && (data || []).length === 0) || !!error;
  return { hidden, leaked: !error && (data || []).length > 0 ? (data || []).length : 0 };
}

async function main() {
  console.log("RLS / authorization tests\n\nanon:");
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });

  for (const t of ["service_requests", "subscribers", "waitlist", "feature_flags"]) {
    const r = await notReadable(anon, t);
    check(`anon cannot read ${t}`, r.hidden, r.leaked ? `${r.leaked} row(s) leaked` : "");
  }
  {
    const { data, error } = await anon.rpc("get_public_stats");
    check("anon can call get_public_stats", !error && data != null, error?.message || "");
  }

  const email = process.env.TEST_STUDENT_EMAIL, password = process.env.TEST_STUDENT_PASSWORD;
  if (email && password) {
    console.log("\nstudent:");
    const stu = createClient(URL, ANON, { auth: { persistSession: false } });
    const { error: signErr } = await stu.auth.signInWithPassword({ email, password });
    check("student can sign in", !signErr, signErr?.message || "");
    if (!signErr) {
      const { data: ff } = await stu.from("feature_flags").select("key").limit(1);
      check("student CAN read feature_flags (authenticated)", (ff || []).length > 0);

      const sr = await notReadable(stu, "service_requests");
      check("student cannot read service_requests", sr.hidden, sr.leaked ? `${sr.leaked} row(s) leaked` : "");

      const { error: flagErr } = await stu.rpc("set_feature_flag", { p_key: "interventions", p_enabled: false });
      check("student cannot call set_feature_flag (founder-only)", !!flagErr, flagErr ? "" : "no error returned");
    }
  } else {
    console.log("\nℹ  student assertions skipped — set TEST_STUDENT_EMAIL / TEST_STUDENT_PASSWORD to include them.");
  }

  console.log(`\n${failures === 0 ? "✅ RLS tests passed" : `❌ ${failures} RLS assertion(s) failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error("RLS test runner error:", e); process.exit(1); });
