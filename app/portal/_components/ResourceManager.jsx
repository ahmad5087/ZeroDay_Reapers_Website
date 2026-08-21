"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Admin resource publishing (Phase 3). Create / edit / publish / delete department- or week-scoped
// resources via the migration-073 RPCs. MVP is URL-based (guides, recordings, templates, tools,
// links); the resources.r2_key column is reserved for direct file uploads in a later pass.
const KINDS = [
  { id: "guide", label: "Guide" },
  { id: "recording", label: "Recording" },
  { id: "template", label: "Template" },
  { id: "tool", label: "Tool" },
  { id: "link", label: "Link" },
];
const EMPTY = { id: null, title: "", description: "", kind: "guide", url: "", domain_id: "", week: "" };

export default function ResourceManager({ me, domains = [] }) {
  const input = "panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-sm";
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data, error } = await supabase.from("resources").select("*").order("updated_at", { ascending: false });
    if (error) setErr(error.message);
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  function edit(r) {
    setForm({ id: r.id, title: r.title, description: r.description || "", kind: r.kind, url: r.url || "", domain_id: r.domain_id ?? "", week: r.week ?? "" });
    setOk(""); setErr("");
  }
  const reset = () => setForm(EMPTY);

  async function save(publish) {
    if (!form.title.trim()) return setErr("Title is required.");
    setErr(""); setOk(""); setBusy(true);
    const { error } = await supabase.rpc("upsert_resource", {
      p_id: form.id,
      p_title: form.title.trim(),
      p_description: form.description.trim() || null,
      p_kind: form.kind,
      p_url: form.url.trim() || null,
      p_r2_key: null,
      p_domain_id: form.domain_id === "" ? null : Number(form.domain_id),
      p_week: form.week === "" ? null : Number(form.week),
      p_publish: publish,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setOk(form.id ? "Resource updated." : "Resource created.");
    reset(); load();
  }

  async function togglePublish(r) {
    setErr(""); setOk("");
    const { error } = await supabase.rpc("set_resource_published", { p_id: r.id, p_published: !r.is_published });
    if (error) return setErr(error.message);
    load();
  }
  async function remove(r) {
    setErr(""); setOk("");
    const { error } = await supabase.rpc("delete_resource", { p_id: r.id });
    if (error) return setErr(error.message);
    if (form.id === r.id) reset();
    load();
  }

  const deptName = (id) => id == null ? "All departments" : (domains.find((d) => d.id === id)?.name || "—");

  return (
    <section className="space-y-5">
      <h2 className="font-mono text-xl text-white">Resources</h2>
      {err && <p className="font-mono text-sm text-blood">{err}</p>}
      {ok && <p className="font-mono text-sm text-[#34d399]">{ok}</p>}

      <div className="panel border border-blood/20 rounded-sm p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className={input} placeholder="Title" value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} />
          <select className={input} value={form.kind} onChange={(e) => setForm((s) => ({ ...s, kind: e.target.value }))}>
            {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
          </select>
          <input className={input + " md:col-span-2"} placeholder="URL (https://…)" value={form.url} onChange={(e) => setForm((s) => ({ ...s, url: e.target.value }))} />
          <textarea rows={2} className={input + " md:col-span-2 resize-y"} placeholder="Description (optional)" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
          <select className={input} value={form.domain_id} onChange={(e) => setForm((s) => ({ ...s, domain_id: e.target.value }))}>
            <option value="">All departments</option>
            {domains.filter((d) => !["lobby", "alumni"].includes(d.key)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <input type="number" min={0} max={52} className={input} placeholder="Week (optional)" value={form.week} onChange={(e) => setForm((s) => ({ ...s, week: e.target.value }))} />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button disabled={busy} onClick={() => save(true)} className="font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm disabled:opacity-50">{form.id ? "Save & publish" : "Create & publish"}</button>
          <button disabled={busy} onClick={() => save(false)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition disabled:opacity-50">Save as draft</button>
          {form.id && <button disabled={busy} onClick={reset} className="font-mono text-xs uppercase tracking-widest border border-neutral-800 text-neutral-500 px-4 py-2 rounded-sm hover:text-neutral-300 transition">Cancel edit</button>}
        </div>
      </div>

      <div className="border border-blood/20 rounded-sm overflow-hidden">
        {rows.length === 0 ? (
          <p className="font-mono text-sm text-neutral-500 p-4">No resources yet.</p>
        ) : rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-blood/10 last:border-b-0">
            <div className="min-w-0">
              <div className="font-mono text-sm text-white truncate">{r.title} <span className="text-[10px] uppercase tracking-widest text-neutral-600">{r.kind}</span></div>
              <div className="font-mono text-[11px] text-neutral-500 truncate">{deptName(r.domain_id)}{r.week != null ? ` · Week ${r.week}` : ""}{r.is_published ? "" : " · draft"}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => togglePublish(r)} className={`font-mono text-[10px] uppercase tracking-widest border px-2.5 py-1 rounded-sm transition ${r.is_published ? "border-[#34d399]/50 text-[#34d399] hover:bg-[#34d399] hover:text-ink-950" : "border-amber-500/50 text-amber-400 hover:bg-amber-500 hover:text-ink-950"}`}>{r.is_published ? "Published" : "Publish"}</button>
              <button onClick={() => edit(r)} className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-blood hover:text-blood transition">Edit</button>
              <button onClick={() => remove(r)} title="Delete" className="font-mono text-[10px] uppercase tracking-widest text-neutral-600 hover:text-blood px-1">✕</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
