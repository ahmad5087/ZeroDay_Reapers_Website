"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Intern/alumni opportunities board + application tracker (Phase 7, #7).
const TYPE_LABEL = { job: "Job", referral: "Referral", competition: "Competition", certification: "Certification", volunteer: "Volunteer" };
const STATUSES = ["saved", "applied", "interview", "offer", "rejected", "withdrawn"];

export default function OpportunitiesBoard({ me, onBack }) {
  const [opps, setOpps] = useState([]);
  const [saves, setSaves] = useState(new Set());
  const [apps, setApps] = useState({}); // opportunity_id -> application row
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("");
  const [tab, setTab] = useState("browse");
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    const [{ data: o }, { data: s }, { data: a }] = await Promise.all([
      supabase.from("opportunities").select("*").eq("is_published", true).order("created_at", { ascending: false }),
      supabase.from("opportunity_saves").select("opportunity_id").eq("user_id", me.id),
      supabase.from("applications").select("*").eq("user_id", me.id),
    ]);
    setOpps(o || []);
    setSaves(new Set((s || []).map((x) => x.opportunity_id)));
    setApps(Object.fromEntries((a || []).map((x) => [x.opportunity_id, x])));
    setLoading(false);
  }
  useEffect(() => { load(); }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleSave(id) {
    const has = saves.has(id);
    setSaves((p) => { const n = new Set(p); if (has) n.delete(id); else n.add(id); return n; });
    if (has) await supabase.from("opportunity_saves").delete().eq("user_id", me.id).eq("opportunity_id", id);
    else await supabase.from("opportunity_saves").insert({ user_id: me.id, opportunity_id: id });
  }
  async function apply(id) {
    const { error } = await supabase.from("applications").upsert({ opportunity_id: id, user_id: me.id, status: "applied" }, { onConflict: "opportunity_id,user_id" });
    if (error) return setErr(error.message);
    load();
  }
  async function setStatus(appId, status) { await supabase.from("applications").update({ status }).eq("id", appId).eq("user_id", me.id); load(); }
  async function saveNotes(appId, notes) { await supabase.from("applications").update({ notes }).eq("id", appId).eq("user_id", me.id); }

  const filtered = useMemo(() => opps.filter((o) => !type || o.type === type), [opps, type]);
  const tracker = useMemo(() => Object.values(apps).map((a) => ({ ...a, opp: opps.find((o) => o.id === a.opportunity_id) })).filter((a) => a.opp), [apps, opps]);
  const tabBtn = (id, label) => (
    <button onClick={() => setTab(id)} className={`font-mono text-[11px] uppercase tracking-widest border px-3 py-2 rounded-sm transition ${tab === id ? "border-blood bg-blood/15 text-white" : "border-neutral-800 text-neutral-400 hover:border-neutral-600"}`}>{label}</button>
  );

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Opportunities</h1>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">← Chat</button>
        </div>
      </header>

      <main className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-mono">
        {err && <p className="text-blood text-sm mb-3">{err}</p>}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {tabBtn("browse", "Browse")}
          {tabBtn("tracker", `My applications (${tracker.length})`)}
          {tab === "browse" && (
            <select value={type} onChange={(e) => setType(e.target.value)} className="ml-auto panel border border-blood/30 outline-none px-3 py-2 text-neutral-100 rounded-sm text-xs">
              <option value="">All types</option>
              {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </div>

        {loading ? (
          <p className="text-center text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-16">Loading…</p>
        ) : tab === "browse" ? (
          filtered.length === 0 ? <p className="text-center text-sm text-neutral-500 py-16">No opportunities right now.</p> : (
            <div className="space-y-3">
              {filtered.map((o) => {
                const applied = apps[o.id];
                return (
                  <div key={o.id} className="border border-blood/20 rounded-sm bg-ink-900/30 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm text-white">{o.title} <span className="text-[10px] uppercase tracking-widest text-neutral-600">{TYPE_LABEL[o.type]}</span></div>
                        <div className="text-[11px] text-neutral-500">{[o.org, o.location].filter(Boolean).join(" · ")}</div>
                        {o.description && <p className="text-xs text-neutral-400 mt-1 line-clamp-3">{o.description}</p>}
                      </div>
                      <button onClick={() => toggleSave(o.id)} title="Save" className={`shrink-0 text-lg leading-none ${saves.has(o.id) ? "text-amber-400" : "text-neutral-600 hover:text-amber-400"}`}>{saves.has(o.id) ? "★" : "☆"}</button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {o.link && <a href={o.link} target="_blank" rel="noopener noreferrer" className="text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-2.5 py-1 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition">Open ↗</a>}
                      {applied ? <span className="text-[10px] uppercase tracking-widest text-[#34d399]">✓ {applied.status}</span>
                               : <button onClick={() => apply(o.id)} className="text-[10px] uppercase tracking-widest btn-neon px-2.5 py-1 rounded-sm">Track application</button>}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          tracker.length === 0 ? <p className="text-center text-sm text-neutral-500 py-16">No applications tracked yet.</p> : (
            <div className="space-y-3">
              {tracker.map((a) => (
                <div key={a.id} className="border border-blood/20 rounded-sm bg-ink-900/30 p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-sm text-white">{a.opp.title} <span className="text-[10px] uppercase tracking-widest text-neutral-600">{TYPE_LABEL[a.opp.type]}</span></div>
                    <select value={a.status} onChange={(e) => setStatus(a.id, e.target.value)} className="panel border border-blood/30 outline-none px-2 py-1 text-neutral-100 rounded-sm text-xs">
                      {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <textarea rows={2} defaultValue={a.notes || ""} onBlur={(e) => saveNotes(a.id, e.target.value)} placeholder="Notes (saved on blur)…" className="w-full mt-2 panel border border-blood/30 focus:border-blood outline-none rounded-sm px-3 py-2 text-xs text-neutral-100 resize-y" />
                </div>
              ))}
            </div>
          )
        )}
      </main>
    </div>
  );
}
