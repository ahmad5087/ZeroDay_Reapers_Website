"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Admin CMS for public posts (Phase 7, #10): case studies / research / advisories / success stories.
// Published posts render on the public site at /insights. Sanitization is a human gate before publish;
// the public renderer (react-markdown) does not execute embedded HTML.
const TYPES = [["case_study", "Case study"], ["research", "Research"], ["advisory", "Advisory"], ["success_story", "Success story"]];
const EMPTY = { id: null, type: "case_study", slug: "", title: "", excerpt: "", body: "", status: "draft" };
const slugify = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

export default function PostsAdmin({ me }) {
  const input = "panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-sm";
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from("posts").select("id,type,slug,title,status,updated_at").order("updated_at", { ascending: false });
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  async function edit(r) {
    const { data } = await supabase.from("posts").select("*").eq("id", r.id).maybeSingle();
    if (data) setForm({ id: data.id, type: data.type, slug: data.slug, title: data.title, excerpt: data.excerpt || "", body: data.body || "", status: data.status });
    setOk(""); setErr("");
  }
  const reset = () => setForm(EMPTY);

  async function save(publish) {
    if (!form.title.trim()) return setErr("Title is required.");
    setErr(""); setOk(""); setBusy(true);
    const payload = {
      type: form.type, slug: (form.slug.trim() || slugify(form.title)), title: form.title.trim(),
      excerpt: form.excerpt.trim() || null, body: form.body, author_id: me.id,
      status: publish ? "published" : "draft",
    };
    const res = form.id ? await supabase.from("posts").update(payload).eq("id", form.id)
                        : await supabase.from("posts").insert(payload);
    setBusy(false);
    if (res.error) return setErr(res.error.message);
    setOk(publish ? "Published." : "Saved as draft."); reset(); load();
  }
  async function togglePub(r) { await supabase.from("posts").update({ status: r.status === "published" ? "draft" : "published" }).eq("id", r.id); load(); }
  async function del(r) { await supabase.from("posts").delete().eq("id", r.id); if (form.id === r.id) reset(); load(); }

  return (
    <section className="space-y-5">
      <h2 className="font-mono text-xl text-white">Case Studies &amp; Posts</h2>
      {err && <p className="font-mono text-sm text-blood">{err}</p>}
      {ok && <p className="font-mono text-sm text-[#34d399]">{ok}</p>}

      <div className="panel border border-blood/20 rounded-sm p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input className={input} placeholder="Title" value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value, slug: s.slug || slugify(e.target.value) }))} />
          <select className={input} value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value }))}>
            {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className={input} placeholder="slug" value={form.slug} onChange={(e) => setForm((s) => ({ ...s, slug: slugify(e.target.value) }))} />
          <input className={input} placeholder="Excerpt (SEO description)" value={form.excerpt} onChange={(e) => setForm((s) => ({ ...s, excerpt: e.target.value }))} />
        </div>
        <textarea rows={10} className={input + " w-full resize-y"} placeholder="Body (Markdown) — headings, **bold**, links. Raw HTML is not rendered." value={form.body} onChange={(e) => setForm((s) => ({ ...s, body: e.target.value }))} />
        <p className="font-mono text-[10px] text-neutral-600">Public URL: /insights/{form.slug || "…"} · Sanitize before publishing — no client names / secrets.</p>
        <div className="flex gap-2 flex-wrap">
          <button disabled={busy} onClick={() => save(true)} className="font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm disabled:opacity-50">{form.id ? "Save & publish" : "Create & publish"}</button>
          <button disabled={busy} onClick={() => save(false)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition disabled:opacity-50">Save draft</button>
          {form.id && <button onClick={reset} className="font-mono text-xs uppercase tracking-widest border border-neutral-800 text-neutral-500 px-4 py-2 rounded-sm hover:text-neutral-300">Cancel</button>}
        </div>
      </div>

      <div className="border border-blood/20 rounded-sm overflow-hidden">
        {rows.length === 0 ? <p className="font-mono text-sm text-neutral-500 p-4">No posts yet.</p> : rows.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3 border-b border-blood/10 last:border-b-0">
            <div className="min-w-0">
              <div className="font-mono text-sm text-white truncate">{r.title} <span className="text-[10px] uppercase tracking-widest text-neutral-600">{r.type}</span></div>
              <div className="font-mono text-[11px] text-neutral-500 truncate">/insights/{r.slug}{r.status === "published" ? "" : " · draft"}</div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => togglePub(r)} className={`font-mono text-[10px] uppercase tracking-widest border px-2.5 py-1 rounded-sm transition ${r.status === "published" ? "border-[#34d399]/50 text-[#34d399] hover:bg-[#34d399] hover:text-ink-950" : "border-amber-500/50 text-amber-400 hover:bg-amber-500 hover:text-ink-950"}`}>{r.status === "published" ? "Published" : "Publish"}</button>
              <button onClick={() => edit(r)} className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-blood hover:text-blood transition">Edit</button>
              <button onClick={() => del(r)} className="font-mono text-[10px] uppercase tracking-widest text-neutral-600 hover:text-blood px-1">✕</button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
