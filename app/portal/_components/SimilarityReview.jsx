"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Admin review of content-based submission similarity (Phase 6). Run analysis (extract + compare via
// the service-role route), then triage flagged pairs with matched passages + a confidence score.
// Review-only: dismissing a false positive never touches the submission.
async function authedPost(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return { ok: res.ok, json: await res.json().catch(() => ({})) };
}

export default function SimilarityReview({ me }) {
  const [pairs, setPairs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threshold, setThreshold] = useState(0.4);
  const [showDismissed, setShowDismissed] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [running, setRunning] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("similarity_pairs").select("*").order("score", { ascending: false });
    setPairs(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function runAnalysis() {
    setErr(""); setOk(""); setRunning(true);
    const r = await authedPost("/api/similarity/extract", {});
    setRunning(false);
    if (!r.ok) return setErr(r.json.error || "Analysis failed (check pdf-parse is installed).");
    setOk(`Extracted ${r.json.extracted} new · ${r.json.pairs} pairs computed.`);
    load();
  }
  async function dismiss(id, val) {
    setErr("");
    const { error } = await supabase.rpc("set_similarity_dismissed", { p_id: id, p_dismissed: val });
    if (error) return setErr(error.message);
    load();
  }

  const shown = pairs.filter((p) => (showDismissed || !p.dismissed) && p.score >= threshold);
  const tone = (s) => (s >= 0.7 ? "text-blood" : s >= 0.5 ? "text-amber-400" : "text-neutral-300");

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-xl text-white">Submission Similarity</h2>
        <button disabled={running} onClick={runAnalysis} className="font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm disabled:opacity-50">{running ? "Analyzing…" : "Run analysis"}</button>
      </div>
      <p className="font-mono text-[11px] text-neutral-500 leading-relaxed">
        Lexical similarity (MinHash) over extracted PDF text. Same-author pairs are ignored.
        <b className="text-amber-400"> Review only — never an automatic penalty.</b> A high score can still be
        legitimate (shared templates or boilerplate) — open both reports and read the matched passages.
      </p>
      {err && <p className="font-mono text-sm text-blood">{err}</p>}
      {ok && <p className="font-mono text-sm text-[#34d399]">{ok}</p>}

      <div className="flex items-center gap-4 flex-wrap font-mono text-[11px] text-neutral-400">
        <label className="flex items-center gap-2">Min score
          <input type="range" min={0.2} max={0.9} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="accent-blood" />
          <span className="tabular-nums text-neutral-300">{Math.round(threshold * 100)}%</span>
        </label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} className="accent-blood" /> Show dismissed</label>
      </div>

      {loading ? (
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-10 text-center">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="font-mono text-sm text-neutral-500 py-10 text-center">No pairs above {Math.round(threshold * 100)}%. Run analysis after submissions come in.</p>
      ) : (
        <div className="space-y-3">
          {shown.map((p) => (
            <div key={p.id} className={`border rounded-sm bg-ink-900/30 p-4 ${p.dismissed ? "border-neutral-800 opacity-60" : "border-blood/20"}`}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-mono text-sm text-white">{p.a_label} <span className="text-neutral-600">↔</span> {p.b_label}</div>
                <div className="flex items-center gap-3">
                  <span className={`font-mono text-sm font-bold tabular-nums ${tone(p.score)}`}>{Math.round(p.score * 100)}%</span>
                  <button onClick={() => dismiss(p.id, !p.dismissed)} className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-blood hover:text-blood transition">{p.dismissed ? "Restore" : "Dismiss"}</button>
                </div>
              </div>
              {Array.isArray(p.matched) && p.matched.length > 0 && (
                <div className="mt-2 space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-600">Matched passages ({p.matched.length})</div>
                  {p.matched.map((m, i) => (
                    <p key={i} className="font-mono text-[11px] text-neutral-400 border-l-2 border-blood/30 pl-2">&ldquo;{String(m).slice(0, 220)}&rdquo;</p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
