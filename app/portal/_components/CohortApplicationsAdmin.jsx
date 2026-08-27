"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Cohort 2 applications admin (Phase 12). Lists waitlist rows (source="cohort-2") with full applicant
// detail and an Accept/Reject action per row. Deciding calls /api/apply/decision, which records the
// decision AND emails the applicant (acceptance or rejection). Admin-only reads/updates are enforced by
// the `waitlist_admin` RLS policy; this component just drives the workflow.

const FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const TONE = { pending: "text-amber-400", accepted: "text-[#34d399]", rejected: "text-blood" };

function fmt(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return "—"; }
}

function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">{label}</div>
      <div className="text-sm text-neutral-200 break-words">{children || "—"}</div>
    </div>
  );
}

export default function CohortApplicationsAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");
  const [busyId, setBusyId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function load() {
    setLoading(true); setErr("");
    const { data, error } = await supabase
      .from("waitlist").select("*").eq("source", "cohort-2")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) return setErr("Couldn't load applications: " + error.message);
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { pending: 0, accepted: 0, rejected: 0, all: rows.length };
    for (const r of rows) c[r.decision || "pending"] = (c[r.decision || "pending"] || 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => (r.decision || "pending") === filter)),
    [rows, filter]
  );

  async function decide(row, decision) {
    setErr(""); setOk(""); setBusyId(row.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/apply/decision", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, decision }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || "Decision failed."); setBusyId(null); return; }
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, decision, decided_at: new Date().toISOString() } : r)));
      setOk(`${decision === "accepted" ? "Accepted" : "Rejected"} ${row.name || row.email}${j.emailed ? " — email sent." : " (saved, but email not sent — check Resend config)."}`);
    } catch {
      setErr("Network error — try again.");
    }
    setBusyId(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-lg text-white">Cohort 2 · Applications</h2>
        <button onClick={load} className="font-mono text-[11px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-blood hover:text-blood transition">
          ↻ Refresh
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`font-mono text-[11px] uppercase tracking-widest border px-3 py-1.5 rounded-sm transition inline-flex items-center gap-2 ${
              filter === f.key ? "border-blood bg-blood/15 text-white" : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
            }`}
          >
            {f.label}
            <span className={`rounded-sm px-1.5 py-0.5 text-[10px] ${filter === f.key ? "bg-blood text-white" : "bg-ink-800 text-blood"}`}>{counts[f.key] || 0}</span>
          </button>
        ))}
      </div>

      {err && <p className="text-blood text-sm">{err}</p>}
      {ok && <p className="text-[#34d399] text-sm">{ok}</p>}

      {loading ? (
        <p className="font-mono text-xs text-neutral-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-neutral-500 text-sm">No {filter === "all" ? "" : filter} applications.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => {
            const decision = r.decision || "pending";
            const open = openId === r.id;
            const busy = busyId === r.id;
            return (
              <li key={r.id} className="panel border border-blood/20 rounded-xl overflow-hidden">
                {/* Summary row */}
                <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                  <button onClick={() => setOpenId(open ? null : r.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium truncate">{r.name || "—"}</span>
                      <span className="text-neutral-500 text-xs">·</span>
                      <span className="text-neutral-300 text-sm truncate">{r.domain || "—"}</span>
                      <span className={`font-mono text-[10px] uppercase tracking-widest ${TONE[decision]}`}>● {decision}</span>
                    </div>
                    <div className="text-neutral-500 text-xs mt-0.5 truncate">{r.email} · applied {fmt(r.created_at)}</div>
                  </button>
                  <div className="flex gap-2">
                    <button
                      disabled={busy || decision === "accepted"}
                      onClick={() => decide(r, "accepted")}
                      className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {busy ? "…" : "Accept"}
                    </button>
                    <button
                      disabled={busy || decision === "rejected"}
                      onClick={() => decide(r, "rejected")}
                      className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1 rounded-sm hover:bg-blood hover:text-ink-950 transition disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {busy ? "…" : "Reject"}
                    </button>
                  </div>
                </div>

                {/* Detail */}
                {open && (
                  <div className="border-t border-blood/10 bg-black/30 px-4 py-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <Detail label="Full name">{r.name}</Detail>
                    <Detail label="Email"><a href={`mailto:${r.email}`} className="text-blood hover:underline">{r.email}</a></Detail>
                    <Detail label="WhatsApp">{r.phone}</Detail>
                    <Detail label="Location">{[r.city, r.country].filter(Boolean).join(", ")}</Detail>
                    <Detail label="Domain">{r.domain}</Detail>
                    <Detail label="Experience">{r.experience}</Detail>
                    <Detail label="RAM">{r.ram ? `${r.ram} GB` : "—"}</Detail>
                    <Detail label="Gender">{r.gender}</Detail>
                    <Detail label="Status">
                      {r.current_status === "Student"
                        ? `Student — ${r.college || "—"}${r.study_year ? ` (${r.study_year})` : ""}`
                        : r.current_status}
                    </Detail>
                    <Detail label="LinkedIn">
                      {r.linkedin_url ? <a href={r.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blood hover:underline break-all">{r.linkedin_url}</a> : "—"}
                    </Detail>
                    <Detail label="Referred by (code)">{r.referral_code}</Detail>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <Detail label="Motivation"><span className="whitespace-pre-wrap">{r.motivation}</span></Detail>
                    </div>
                    {decision !== "pending" && (
                      <div className="sm:col-span-2 lg:col-span-3 text-neutral-500 text-xs font-mono">
                        {decision === "accepted" ? "Accepted" : "Rejected"} · {fmt(r.decided_at)}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
