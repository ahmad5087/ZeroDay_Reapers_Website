"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Admin management of the alumni opportunities board (Phase 7, #7). Admin-write RLS, so writes go
// straight through supabase (no RPC).
const TYPES = [["job", "Job"], ["referral", "Referral"], ["competition", "Competition"], ["certification", "Certification"], ["volunteer", "Volunteer"]];
const EMPTY = { id: null, type: "job", title: "", org: "", link: "", location: "", description: "", expires_at: "", is_published: true };

export default function OpportunitiesAdmin({ me }) {
  const input = "panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-sm";
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("opportunities").select("*").order("created_at", { ascending: false });
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  function edit(r) {
    setForm({ id: r.id, type: r.type, title: r.title, org: r.org || "", link: r.link || "", location: r.location || "", description: r.description || "", expires_at: r.expires_at ? r.expires_at.slice(0, 10) : "", is_published: r.is_published });
    setOk(""); setErr("");
  }
  const reset = () => setForm(EMPTY);

  async function save() {
    if (!form.title.trim()) return setErr("Title is required.");
    setErr(""); setOk(""); setBusy(true);
    const payload = {
      type: form.type, title: form.title.trim(), org: form.org.trim() || null, link: form.link.trim() || null,
      location: form.location.trim() || null, description: form.description.trim() || null,
      expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
      is_published: form.is_published, posted_by: me.id,
    };
    const res = form.id ? await supabase.from("opportunities").update(payload).eq("id", form.id)
                        : await supabase.from("opportunities").insert(payload);
    setBusy(false);
    if (res.error) return setErr(res.error.message);
    setOk(form.id ? "Updated." : "Created."); reset(); load();
  }
  async function togglePub(r) { await supabase.from("opportunities").update({ is_published: !r.is_published }).eq("id", r.id); load(); }
  async function del(r) { await supabase.from("opportunities").delete().eq("id", r.id); if (form.id === r.id) reset(); load(); }

  return (
    <section className="space-y-5">
      <h2 className="font-mono text-xl text-white">Opportunities</h2>
      {err && <p className="font-mono text-sm text-blood">{err}</p>}
      {ok && <p className="font-mono text-sm text-[#34d399]">{ok}</p>}

      <div className="panel border border-blood/20 rounded-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <input className={input} placeholder="Title" value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} />
        <select className={input} value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value }))}>
          {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input className={input} placeholder="Organisation" value={form.org} onChange={(e) => setForm((s) => ({ ...s, org: e.target.value }))} />
        <input className={input} placeholder="Location" value={form.location} onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))} />
        <input className={input + " md:col-span-2"} placeholder="Link (https://…)" value={form.link} onChange={(e) => setForm((s) => ({ ...s, link: e.target.value }))} />
        <textarea rows={2} className={input + " md:col-span-2 resize-y"} placeholder="Description" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
        <label className="text-[10px] uppercase tracking-widest text-neutral-500">Expires (optional)
          <input type="date" className={input + " w-full mt-1"} value={form.expires_at} onChange={(e) => setForm((s) => ({ ...s, expires_at: e.target.value }))} />
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-300 self-end">
          <input type="checkbox" checked={form.is_published} onChange={(e) => setForm((s) => ({ ...s, is_published: e.target.checked }))} className="accent-blood" /> Published
        </label>
        <div className="md:col-span-2 flex gap-2">
          <button disabled={busy} onClick={save} className="font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm disabled:opacity-50">{form.id ? "Save" : "Create"}</button>
          {form.id && <button onClick={reset} className="font-mono text-xs uppercase tracking-widest border border-neutral-800 text-neutral-500 px-4 py-2 rounded-sm hover:text-neutral-300">Cancel</button>}
        </div>
      </div>

      <div className="border border-blood/20 rounded-sm overflow-hidden">
        {rows.length === 0 ? <p className="font-mono text-sm text-neutral-500 p-4">No opportunities yet.</p> : rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-blood/10 last:border-b-0">
            <div className="min-w-0">
              <div className="font-mono text-sm text-white truncate">{r.title} <span className="text-[10px] uppercase tracking-widest text-neutral-600">{r.type}</span></div>
              <div className="font-mono text-[11px] text-neutral-500 truncate">{[r.org, r.location].filter(Boolean).join(" · ") || "—"}{r.is_published ? "" : " · draft"}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => togglePub(r)} className={`font-mono text-[10px] uppercase tracking-widest border px-2.5 py-1 rounded-sm transition ${r.is_published ? "border-[#34d399]/50 text-[#34d399] hover:bg-[#34d399] hover:text-ink-950" : "border-amber-500/50 text-amber-400 hover:bg-amber-500 hover:text-ink-950"}`}>{r.is_published ? "Published" : "Publish"}</button>
              <button onClick={() => edit(r)} className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-blood hover:text-blood transition">Edit</button>
              <button onClick={() => del(r)} className="font-mono text-[10px] uppercase tracking-widest text-neutral-600 hover:text-blood px-1">✕</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
