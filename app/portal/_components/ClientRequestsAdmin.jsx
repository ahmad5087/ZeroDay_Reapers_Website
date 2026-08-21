"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Admin pipeline for website leads / client engagements (Phase 8, #9). View structured requests,
// move status + proposal, and post client-visible updates. The client tracks progress via the
// token link (Copy client link). Binary R2 document exchange is a deferred follow-up.
const STATUS = ["new", "triage", "scoping", "proposal", "active", "closed"];
const PROP = ["none", "draft", "sent", "accepted", "declined"];

export default function ClientRequestsAdmin({ me }) {
  const input = "panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-sm";
  const [rows, setRows] = useState([]);
  const [sel, setSel] = useState(null);
  const [updates, setUpdates] = useState([]);
  const [note, setNote] = useState("");
  const [noteLink, setNoteLink] = useState("");
  const [noteVisible, setNoteVisible] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function load() {
    const { data } = await supabase.from("service_requests").select("*").order("created_at", { ascending: false });
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  async function open(r) {
    setSel(r); setOk(""); setErr("");
    const { data } = await supabase.from("engagement_updates").select("*").eq("request_id", r.id).order("created_at", { ascending: false });
    setUpdates(data || []);
  }
  async function patch(fields) {
    if (!sel) return;
    const { error } = await supabase.from("service_requests").update(fields).eq("id", sel.id);
    if (error) return setErr(error.message);
    setSel((s) => ({ ...s, ...fields })); load();
  }
  async function postUpdate() {
    if (!sel || (!note.trim() && !noteLink.trim())) return;
    const { error } = await supabase.from("engagement_updates").insert({
      request_id: sel.id, body: note.trim() || null, link: noteLink.trim() || null,
      kind: noteLink.trim() ? "document" : "update", visible_to_client: noteVisible, author_id: me.id,
    });
    if (error) return setErr(error.message);
    setNote(""); setNoteLink(""); open(sel);
  }
  async function copyLink() {
    const url = `${typeof location !== "undefined" ? location.origin : ""}/engagement/${sel.access_token}`;
    try { await navigator.clipboard.writeText(url); setOk("Client link copied."); } catch { setOk(url); }
  }

  const scope = sel?.scope || {};

  return (
    <section>
      <h2 className="font-mono text-xl text-white mb-4">Clients</h2>
      {err && <p className="font-mono text-sm text-blood mb-3">{err}</p>}
      {ok && <p className="font-mono text-sm text-[#34d399] mb-3">{ok}</p>}

      <div className="grid lg:grid-cols-[minmax(0,300px),1fr] gap-4 items-start">
        {/* List */}
        <div className="border border-blood/20 rounded-sm overflow-hidden">
          {rows.length === 0 ? <p className="font-mono text-sm text-neutral-500 p-4">No requests yet.</p> : rows.map((r) => (
            <button key={r.id} onClick={() => open(r)} className={`w-full text-left px-3 py-2.5 border-b border-blood/10 last:border-b-0 transition ${sel?.id === r.id ? "bg-blood/10" : "hover:bg-ink-900/50"}`}>
              <div className="font-mono text-sm text-white truncate">{r.title}</div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">{r.status} · {r.org || r.email}</div>
            </button>
          ))}
        </div>

        {/* Detail */}
        {!sel ? (
          <p className="font-mono text-sm text-neutral-500 p-4">Select a request.</p>
        ) : (
          <div className="space-y-4">
            <div className="panel border border-blood/20 rounded-sm p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="font-mono text-white">{sel.title}</div>
                <button onClick={copyLink} className="font-mono text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-2.5 py-1 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition">Copy client link</button>
              </div>
              <div className="font-mono text-[11px] text-neutral-500 mt-1">{[sel.name, sel.email, sel.org].filter(Boolean).join(" · ")}</div>
              <div className="mt-3 grid grid-cols-2 gap-2 font-mono text-[11px] text-neutral-400">
                {Object.entries(scope).map(([k, v]) => <div key={k}><span className="text-neutral-600 uppercase tracking-widest text-[9px]">{k}</span><br />{String(v || "—")}</div>)}
              </div>
            </div>

            <div className="panel border border-blood/20 rounded-sm p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-[10px] uppercase tracking-widest text-neutral-500">Status
                <select className={input + " w-full mt-1"} value={sel.status} onChange={(e) => patch({ status: e.target.value })}>{STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </label>
              <label className="text-[10px] uppercase tracking-widest text-neutral-500">Proposal
                <select className={input + " w-full mt-1"} value={sel.proposal_status} onChange={(e) => patch({ proposal_status: e.target.value })}>{PROP.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </label>
              <label className="text-[10px] uppercase tracking-widest text-neutral-500">Amount ($)
                <input type="number" className={input + " w-full mt-1"} defaultValue={sel.proposal_amount ?? ""} onBlur={(e) => patch({ proposal_amount: e.target.value === "" ? null : Number(e.target.value) })} />
              </label>
              <label className="text-[10px] uppercase tracking-widest text-neutral-500">Proposal note
                <input className={input + " w-full mt-1"} defaultValue={sel.proposal_note ?? ""} onBlur={(e) => patch({ proposal_note: e.target.value.trim() || null })} />
              </label>
            </div>

            <div className="panel border border-blood/20 rounded-sm p-4 space-y-2">
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Post an update</div>
              <textarea rows={2} className={input + " w-full resize-y"} placeholder="Update body…" value={note} onChange={(e) => setNote(e.target.value)} />
              <input className={input + " w-full"} placeholder="Document link (optional)" value={noteLink} onChange={(e) => setNoteLink(e.target.value)} />
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <label className="flex items-center gap-2 font-mono text-[11px] text-neutral-400"><input type="checkbox" checked={noteVisible} onChange={(e) => setNoteVisible(e.target.checked)} className="accent-blood" /> Visible to client</label>
                <button onClick={postUpdate} className="font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm">Post</button>
              </div>
              <div className="mt-2 space-y-2">
                {updates.map((u) => (
                  <div key={u.id} className="border border-neutral-800 rounded-sm p-2.5">
                    <div className="flex items-center justify-between font-mono text-[10px] text-neutral-600">
                      <span>{u.kind}{u.visible_to_client ? "" : " · internal"}</span><span>{new Date(u.created_at).toLocaleString()}</span>
                    </div>
                    {u.body && <p className="font-mono text-xs text-neutral-300 mt-1 whitespace-pre-wrap">{u.body}</p>}
                    {u.link && <a href={u.link} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-[#38bdf8]">{u.link}</a>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
