"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Competency axes = the four rubric axes graded on APPROVED submissions (migrations 047/051),
// surfaced as an intern-facing "Skill Passport". No new schema — this aggregates existing marks.
// Gated behind the `competency_matrix` feature flag; renders null when the flag is off.
const AXES = [
  { key: "score_completeness", label: "Completeness", hint: "Scope & thoroughness" },
  { key: "score_accuracy",     label: "Accuracy",     hint: "Investigation correctness" },
  { key: "score_evidence",     label: "Evidence",     hint: "Proof & artefacts" },
  { key: "score_report",       label: "Reporting",    hint: "Clarity & write-up" },
];

function barTone(v) {
  if (v == null) return "bg-neutral-700";
  if (v >= 8) return "bg-[#34d399]";
  if (v >= 6) return "bg-amber-400";
  return "bg-blood";
}

export default function SkillPassport({ me }) {
  const [enabled, setEnabled] = useState(null); // null = loading, false = flag off
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stop = false;
    (async () => {
      const { data: flag } = await supabase.from("feature_flags").select("enabled").eq("key", "competency_matrix").maybeSingle();
      if (stop) return;
      if (!flag?.enabled) { setEnabled(false); setLoading(false); return; }
      setEnabled(true);
      const { data } = await supabase.from("submissions")
        .select("id,status,score_completeness,score_accuracy,score_evidence,score_report,score_overall,graded_at,tasks(week,title)")
        .eq("user_id", me.id).eq("status", "approved").not("graded_at", "is", null);
      if (!stop) { setRows(data || []); setLoading(false); }
    })();
    return () => { stop = true; };
  }, [me.id]);

  const profile = useMemo(() => {
    const scored = rows.filter((r) => r.score_overall != null);
    const avg = (key) => {
      const vals = scored.map((r) => r[key]).filter((v) => v != null).map(Number);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const axes = AXES.map((a) => ({ ...a, value: avg(a.key) }));
    const rated = axes.filter((a) => a.value != null);
    const strongest = rated.length ? rated.reduce((m, a) => (a.value > m.value ? a : m)) : null;
    const weakest = rated.length ? rated.reduce((m, a) => (a.value < m.value ? a : m)) : null;
    const overallPct = scored.length
      ? Math.round((scored.reduce((s, r) => s + Number(r.score_overall), 0) / (scored.length * 40)) * 100)
      : null;
    return { axes, strongest, weakest, overallPct, count: scored.length };
  }, [rows]);

  function exportPortfolio() {
    const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const axisRows = profile.axes.map((a) => `<tr><td>${esc(a.label)}</td><td>${a.value == null ? "&mdash;" : a.value.toFixed(1) + " / 10"}</td></tr>`).join("");
    const workRows = rows.slice().sort((a, b) => (a.tasks?.week || 0) - (b.tasks?.week || 0))
      .map((r) => `<tr><td>Week ${esc(r.tasks?.week)}</td><td>${esc(r.tasks?.title || "Task")}</td><td>${r.score_overall == null ? "&mdash;" : Number(r.score_overall).toFixed(1) + " / 40"}</td></tr>`).join("");
    const html = `<!doctype html><meta charset="utf-8"><title>ZeroDay Reapers Portfolio — ${esc(me.display_name || "")}</title>
<style>body{font:14px/1.6 system-ui,Segoe UI,Arial,sans-serif;max-width:760px;margin:40px auto;padding:0 20px;color:#111}
h1{margin:0 0 4px}h2{margin:28px 0 8px;border-bottom:2px solid #e10600;padding-bottom:4px}
table{border-collapse:collapse;width:100%;margin-top:8px}td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}
.muted{color:#666}</style>
<h1>${esc(me.display_name || "Intern")}</h1>
<p class="muted">${esc(me.member_id || "")}${me.domains?.name ? " &middot; " + esc(me.domains.name) : ""} &middot; ZeroDay Reapers Internship</p>
<h2>Competency profile</h2>
<p>Overall: <b>${profile.overallPct == null ? "&mdash;" : profile.overallPct + "%"}</b> across ${profile.count} approved deliverable(s).</p>
<table><tr><th>Skill</th><th>Average</th></tr>${axisRows}</table>
<h2>Approved deliverables</h2>
<table><tr><th>Week</th><th>Task</th><th>Score</th></tr>${workRows || '<tr><td colspan="3" class="muted">No approved deliverables yet.</td></tr>'}</table>
<p class="muted" style="margin-top:28px">Generated ${new Date().toLocaleDateString()} &middot; ZeroDay Reapers</p>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ZDR-portfolio-${String(me.member_id || me.id || "intern").replace(/[^\w-]/g, "")}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (enabled === false || loading) return null; // flag off, or silent while resolving

  if (profile.count === 0) {
    return (
      <div className="panel border border-blood/15 rounded-sm p-5">
        <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-2">Skill Passport</h2>
        <p className="text-xs text-neutral-500">Your competency profile appears here once an admin grades an approved deliverable on the rubric.</p>
      </div>
    );
  }

  return (
    <div className="panel border border-blood/20 rounded-sm p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="text-xs uppercase tracking-widest text-neutral-400">Skill Passport</h2>
          <p className="text-2xl font-bold text-white mt-1">{profile.overallPct}% <span className="text-blood text-base font-normal">overall</span></p>
        </div>
        <button onClick={exportPortfolio} className="font-mono text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-3 py-2 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition">
          ⬇ Download portfolio
        </button>
      </div>

      <div className="space-y-3">
        {profile.axes.map((a) => (
          <div key={a.key}>
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-xs text-neutral-300">{a.label} <span className="text-neutral-600">· {a.hint}</span></span>
              <span className="text-xs font-mono text-neutral-400 tabular-nums">{a.value == null ? "—" : a.value.toFixed(1) + " / 10"}</span>
            </div>
            <div className="h-2 bg-neutral-800 rounded-sm overflow-hidden">
              <div className={`h-full ${barTone(a.value)} transition-all`} style={{ width: `${a.value == null ? 0 : (a.value / 10) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      {profile.strongest && profile.weakest && profile.strongest.key !== profile.weakest.key && (
        <p className="mt-4 text-[11px] text-neutral-500">
          Strongest: <span className="text-[#34d399]">{profile.strongest.label}</span> · Focus area: <span className="text-amber-400">{profile.weakest.label}</span>
        </p>
      )}
      <p className="mt-1 text-[10px] uppercase tracking-widest text-neutral-600">Based on {profile.count} approved deliverable(s)</p>
    </div>
  );
}
