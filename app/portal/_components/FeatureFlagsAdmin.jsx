"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Founder-only feature-flag control panel (migration 081). Flips public.feature_flags rows in-app
// through set_feature_flag() instead of the Supabase SQL editor. It lists EVERY row in the table, so
// any flag seeded by a future migration shows up here automatically — no code change needed to manage
// a new feature's switch. See FEATURE_FLAGS.md for the rollout waves.

// Flags whose feature pulls in new npm packages: only safe to enable AFTER the Vercel deploy is green.
const NEEDS_DEPS = new Set(["submission_similarity", "alumni_board", "case_studies", "passkeys"]);

// Preferred display order (roadmap order). Unknown/future keys are appended alphabetically.
const ORDER = [
  "interventions", "submission_similarity", "competency_matrix", "resource_library",
  "office_hours", "alumni_board", "weekly_digest", "passkeys", "case_studies", "client_portal",
];
const orderIndex = (k) => { const i = ORDER.indexOf(k); return i === -1 ? ORDER.length : i; };

function fmtWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function FeatureFlagsAdmin({ me, onChanged }) {
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("feature_flags")
      .select("key,enabled,label,updated_at");
    if (error) setErr(error.message);
    const sorted = (data || []).sort(
      (a, b) => orderIndex(a.key) - orderIndex(b.key) || a.key.localeCompare(b.key)
    );
    setRows(sorted);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function toggle(row) {
    const next = !row.enabled;
    setErr(""); setOk(""); setBusyKey(row.key);
    const { error } = await supabase.rpc("set_feature_flag", { p_key: row.key, p_enabled: next });
    setBusyKey("");
    if (error) return setErr(`${row.key}: ${error.message}`);
    setOk(`${row.label || row.key} turned ${next ? "ON" : "OFF"}.`);
    // Reflect immediately, then refresh from the DB and let the parent re-gate its tabs live.
    setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, enabled: next, updated_at: new Date().toISOString() } : r)));
    load();
    onChanged?.();
  }

  const onCount = rows.filter((r) => r.enabled).length;

  return (
    <section className="space-y-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-xl text-white">Feature Flags</h2>
        <span className="font-mono text-[11px] text-neutral-500">{onCount}/{rows.length} on · founder only</span>
      </div>

      <p className="font-mono text-xs text-neutral-400 leading-relaxed max-w-2xl">
        Flip a feature on or off for everyone, instantly — no redeploy, no SQL. Turning one OFF hides it
        immediately but keeps any data created while it was on, so you can toggle back and forth safely.
        <span className="text-amber-400"> Flags tagged “needs deploy” pull in new packages — only enable those after the latest Vercel build is green.</span>
      </p>

      {err && <p className="font-mono text-sm text-blood">{err}</p>}
      {ok && <p className="font-mono text-sm text-[#34d399]">{ok}</p>}

      <div className="border border-blood/20 rounded-sm overflow-hidden">
        {loading ? (
          <p className="font-mono text-sm text-neutral-500 p-4">Loading flags…</p>
        ) : rows.length === 0 ? (
          <p className="font-mono text-sm text-neutral-500 p-4">
            No flags found. Apply migrations 071 and 081, then reload.
          </p>
        ) : rows.map((r) => (
          <div key={r.key} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-blood/10 last:border-b-0">
            <div className="min-w-0">
              <div className="font-mono text-sm text-white truncate flex items-center gap-2">
                <span className="truncate">{r.label || r.key}</span>
                {NEEDS_DEPS.has(r.key) && (
                  <span className="shrink-0 text-[9px] uppercase tracking-widest border border-amber-500/50 text-amber-400 px-1.5 py-0.5 rounded-sm">needs deploy</span>
                )}
              </div>
              <div className="font-mono text-[11px] text-neutral-500 truncate">
                <span className="text-neutral-600">{r.key}</span>
                {r.updated_at ? ` · updated ${fmtWhen(r.updated_at)}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className={`font-mono text-[10px] uppercase tracking-widest ${r.enabled ? "text-[#34d399]" : "text-neutral-600"}`}>
                {r.enabled ? "On" : "Off"}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={r.enabled}
                aria-label={`Toggle ${r.label || r.key}`}
                disabled={busyKey === r.key}
                onClick={() => toggle(r)}
                className={`relative h-6 w-11 rounded-full border transition disabled:opacity-50 ${r.enabled ? "bg-[#34d399]/20 border-[#34d399]" : "bg-ink-800 border-neutral-700"}`}
              >
                <span
                  className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 rounded-full transition-all ${r.enabled ? "left-[22px] bg-[#34d399]" : "left-0.5 bg-neutral-500"}`}
                />
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="font-mono text-[11px] text-neutral-600 leading-relaxed">
        Every change is audit-logged. The Supabase SQL editor path in FEATURE_FLAGS.md still works too
        (fixed in migration 081): <code className="text-neutral-400">select public.set_feature_flag('key', true);</code>
      </p>
    </section>
  );
}
