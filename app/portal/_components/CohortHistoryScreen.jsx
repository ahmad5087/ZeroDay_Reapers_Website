"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { downloadFromR2 } from "@/lib/r2client";
import { rubricForWeek } from "../_lib";

// "Previous Cohort" history — the read-only record a RETURNING intern keeps from each cohort they finished
// before the current one. Everything is per-cohort: the archived enrollment row (member id, domain, fee
// proof, certificate/LOR) comes from get_cohort_enrollments (mig 125/127/128); the weekly tasks + the
// intern's own submissions/grades come from get_cohort_work (mig 128, which reads past the current-cohort
// RLS). The menu entry that reaches this screen is only shown to interns who actually have an archived
// enrollment (gated in page.jsx), so an empty state here is a safe fallback, not the normal case.

const AXES = [
  { key: "score_completeness", label: "Completeness" },
  { key: "score_accuracy", label: "Accuracy" },
  { key: "score_evidence", label: "Evidence" },
  { key: "score_report", label: "Reporting" },
  { key: "score_video", label: "Video demo" },
];

const STATUS = {
  approved: { label: "Approved", tone: "text-emerald-400" },
  rejected: { label: "Rejected", tone: "text-blood" },
  submitted: { label: "Pending", tone: "text-amber-400" },
  pending: { label: "Pending", tone: "text-amber-400" },
};

function fmtDate(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }); }
  catch { return "—"; }
}

export default function CohortHistoryScreen({ me, onBack }) {
  const [rows, setRows] = useState(null); // null = loading; array of archived enrollments
  const [domains, setDomains] = useState({});

  useEffect(() => {
    let stop = false;
    (async () => {
      const [{ data: enr }, { data: doms }] = await Promise.all([
        supabase.rpc("get_cohort_enrollments", { p_user: me.id }),
        supabase.from("domains").select("id,name"),
      ]);
      if (stop) return;
      setDomains(Object.fromEntries((doms || []).map((d) => [d.id, d.name])));
      setRows((enr || []).filter((e) => e.status === "archived").sort((a, b) => b.cohort - a.cohort));
    })();
    return () => { stop = true; };
  }, [me.id]);

  return (
    <div className="min-h-screen bg-ink-950">
      <header className="sticky top-0 z-10 glass-strong glass-red border-b border-blood/20">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="font-mono text-sm uppercase tracking-widest text-white">Previous Cohort</h1>
            <p className="font-mono text-[11px] text-neutral-400">Your record from each cohort you completed before this one.</p>
          </div>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition shrink-0">← Back</button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {rows === null ? (
          <p className="font-mono text-xs text-neutral-500 animate-pulse">Loading your history…</p>
        ) : rows.length === 0 ? (
          <p className="rounded-sm border border-neutral-800 p-5 font-mono text-xs text-neutral-500">No previous cohorts on record.</p>
        ) : (
          rows.map((e) => <CohortCard key={e.cohort} me={me} enr={e} domainName={domains[e.domain_id] || "—"} />)
        )}
      </main>
    </div>
  );
}

function CohortCard({ me, enr, domainName }) {
  const [open, setOpen] = useState(false);
  const [work, setWork] = useState(null); // null = not loaded yet; array once loaded
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && work === null && !busy) {
      setBusy(true);
      const { data } = await supabase.rpc("get_cohort_work", { p_user: me.id, p_cohort: enr.cohort });
      setWork(data || []);
      setBusy(false);
    }
  }

  const passport = useMemo(() => {
    const scored = (work || []).filter((r) => r.status === "approved" && r.score_overall != null);
    const axisMax = (key, week) => rubricForWeek(week).axes.find((a) => a.key === key)?.max ?? null;
    const avg = (key) => {
      const vals = scored.map((r) => {
        const raw = r[key];
        if (raw == null) return null;
        const mx = axisMax(key, r.week);
        return mx ? (Number(raw) / mx) * 10 : null;
      }).filter((v) => v != null);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    };
    const totalMax = scored.reduce((t, r) => t + rubricForWeek(r.week).total, 0);
    const overallPct = totalMax ? Math.round((scored.reduce((s, r) => s + Number(r.score_overall), 0) / totalMax) * 100) : null;
    return { axes: AXES.map((a) => ({ ...a, value: avg(a.key) })), overallPct, count: scored.length };
  }, [work]);

  const view = (key, name) => { if (key) downloadFromR2(key, name, { inline: true }).catch(() => {}); };

  return (
    <div className="panel border border-blood/20 rounded-sm overflow-hidden">
      <button onClick={toggle} className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/5 transition">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm text-white">Cohort {enr.cohort}</span>
            {enr.is_best_intern && <span className="font-mono text-[10px] uppercase tracking-widest text-amber-400 border border-amber-400/40 px-1.5 py-0.5 rounded-sm">★ Best Intern</span>}
          </div>
          <p className="font-mono text-[11px] text-neutral-400 mt-0.5 truncate">{domainName} · {enr.member_id || "—"} · {fmtDate(enr.enrolled_at)} → {fmtDate(enr.ended_at)}</p>
        </div>
        <span className="font-mono text-xs text-neutral-500 shrink-0">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="border-t border-neutral-800 px-5 py-4 space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Fee:</span>
            <span className={`font-mono text-[11px] ${enr.payment_confirmed ? "text-emerald-400" : enr.payment_proof_url ? "text-amber-400" : "text-neutral-500"}`}>
              {enr.payment_confirmed ? "Confirmed" : enr.payment_proof_url ? "Submitted" : "Not submitted"}
              {enr.payment_proof_submitted_at ? ` · ${fmtDate(enr.payment_proof_submitted_at)}` : ""}
            </span>
            {enr.payment_proof_url && <button onClick={() => view(enr.payment_proof_url, `fee-proof-cohort${enr.cohort}`)} className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2 py-1 rounded-sm hover:border-blood hover:text-blood transition">View proof</button>}
            {enr.certificate_key && <button onClick={() => view(enr.certificate_key, `certificate-cohort${enr.cohort}.pdf`)} className="font-mono text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-2 py-1 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition">Certificate</button>}
            {enr.lor_key && <button onClick={() => view(enr.lor_key, `LOR-cohort${enr.cohort}.pdf`)} className="font-mono text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-2 py-1 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition">LOR</button>}
          </div>

          {passport.count > 0 && (
            <div>
              <div className="flex items-baseline gap-2 mb-2">
                <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Skill passport</span>
                <span className="font-mono text-sm text-white">{passport.overallPct == null ? "—" : passport.overallPct + "%"}</span>
                <span className="font-mono text-[10px] text-neutral-600">({passport.count} approved)</span>
              </div>
              <div className="space-y-1.5">
                {passport.axes.filter((a) => a.value != null).map((a) => (
                  <div key={a.key}>
                    <div className="flex items-baseline justify-between mb-0.5">
                      <span className="text-[11px] text-neutral-400">{a.label}</span>
                      <span className="font-mono text-[10px] text-neutral-500">{a.value.toFixed(1)} / 10</span>
                    </div>
                    <div className="h-1.5 bg-neutral-800 rounded-sm overflow-hidden"><div className="h-full bg-blood" style={{ width: `${(a.value / 10) * 100}%` }} /></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Weekly work</span>
            {busy && work === null ? (
              <p className="font-mono text-[11px] text-neutral-600 mt-2 animate-pulse">Loading…</p>
            ) : (work || []).length === 0 ? (
              <p className="font-mono text-[11px] text-neutral-600 mt-2">No tasks were published for this cohort.</p>
            ) : (
              <div className="mt-2 space-y-1.5">
                {work.map((t) => {
                  const st = t.status ? STATUS[t.status] : null;
                  return (
                    <div key={t.task_id} className="flex items-start justify-between gap-3 border border-neutral-800 rounded-sm px-3 py-2">
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-neutral-300"><span className="text-neutral-500">W{t.week}</span> · {t.title}</p>
                        {t.feedback && <p className="text-[11px] text-neutral-500 mt-1 whitespace-pre-wrap break-words">{t.feedback}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`font-mono text-[10px] uppercase tracking-widest ${st ? st.tone : "text-neutral-600"}`}>{st ? st.label : "No submission"}</p>
                        {t.score_overall != null && <p className="font-mono text-[11px] text-white mt-0.5">{Number(t.score_overall).toFixed(1)} / {rubricForWeek(t.week).total}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
