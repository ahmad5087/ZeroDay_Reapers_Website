"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Intern-facing Resource Library (Phase 3). Browse published resources (RLS shows published rows),
// search, filter by week, bookmark, and mark complete. Bookmarks/progress are own-row writes.
const KIND_ICON = { guide: "📘", recording: "🎥", template: "📄", tool: "🛠", link: "🔗" };

export default function ResourceLibrary({ me, onBack }) {
  const [rows, setRows] = useState([]);
  const [bookmarks, setBookmarks] = useState(new Set());
  const [done, setDone] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [week, setWeek] = useState("");
  const [onlyBookmarks, setOnlyBookmarks] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: res }, { data: bm }, { data: pr }] = await Promise.all([
      supabase.from("resources").select("*").eq("is_published", true)
        .order("week", { ascending: true }).order("created_at", { ascending: false }),
      supabase.from("resource_bookmarks").select("resource_id").eq("user_id", me.id),
      supabase.from("resource_progress").select("resource_id").eq("user_id", me.id),
    ]);
    setRows(res || []);
    setBookmarks(new Set((bm || []).map((b) => b.resource_id)));
    setDone(new Set((pr || []).map((p) => p.resource_id)));
    setLoading(false);
  }
  useEffect(() => { load(); }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function toggleBookmark(id) {
    const has = bookmarks.has(id);
    setBookmarks((s) => { const n = new Set(s); if (has) n.delete(id); else n.add(id); return n; });
    if (has) await supabase.from("resource_bookmarks").delete().eq("user_id", me.id).eq("resource_id", id);
    else await supabase.from("resource_bookmarks").insert({ user_id: me.id, resource_id: id });
  }
  async function toggleDone(id) {
    const has = done.has(id);
    setDone((s) => { const n = new Set(s); if (has) n.delete(id); else n.add(id); return n; });
    if (has) await supabase.from("resource_progress").delete().eq("user_id", me.id).eq("resource_id", id);
    else await supabase.from("resource_progress").insert({ user_id: me.id, resource_id: id });
  }

  const weeks = useMemo(() => [...new Set(rows.map((r) => r.week).filter((w) => w != null))].sort((a, b) => a - b), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (onlyBookmarks && !bookmarks.has(r.id)) return false;
      if (week !== "" && String(r.week) !== String(week)) return false;
      if (needle && !`${r.title} ${r.description || ""}`.toLowerCase().includes(needle)) return false;
      // Show all-department resources plus the intern's own department.
      if (me.role !== "admin" && r.domain_id != null && me.domain_id != null && r.domain_id !== me.domain_id) return false;
      return true;
    });
  }, [rows, q, week, onlyBookmarks, bookmarks, me]);

  const inputCls = "panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm text-sm";

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Resource Library</h1>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">← Chat</button>
        </div>
      </header>

      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 font-mono">
        <div className="flex gap-2 flex-wrap mb-4">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className={inputCls + " flex-1 min-w-[180px]"} />
          <select value={week} onChange={(e) => setWeek(e.target.value)} className={inputCls + " text-xs"}>
            <option value="">All weeks</option>
            {weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
          </select>
          <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-neutral-400 px-2">
            <input type="checkbox" checked={onlyBookmarks} onChange={(e) => setOnlyBookmarks(e.target.checked)} className="accent-blood" /> Saved
          </label>
        </div>

        {loading ? (
          <p className="text-center text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-16">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-center text-sm text-neutral-500 py-16">No resources found.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((r) => (
              <div key={r.id} className={`border rounded-sm p-4 bg-ink-900/30 flex flex-col gap-2 ${done.has(r.id) ? "border-[#34d399]/40" : "border-blood/20"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-white">{KIND_ICON[r.kind] || "🔗"} {r.title}</span>
                  <button onClick={() => toggleBookmark(r.id)} title="Bookmark" className={`shrink-0 text-lg leading-none ${bookmarks.has(r.id) ? "text-amber-400" : "text-neutral-600 hover:text-amber-400"}`}>{bookmarks.has(r.id) ? "★" : "☆"}</button>
                </div>
                {r.description && <p className="text-xs text-neutral-400 line-clamp-3">{r.description}</p>}
                <div className="text-[10px] uppercase tracking-widest text-neutral-600">{r.week != null ? `Week ${r.week}` : "Any week"} · {r.kind}</div>
                <div className="flex items-center gap-2 mt-auto pt-2">
                  {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-mono text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-2.5 py-1 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition">Open ↗</a>}
                  <button onClick={() => toggleDone(r.id)} className={`font-mono text-[10px] uppercase tracking-widest border px-2.5 py-1 rounded-sm transition ${done.has(r.id) ? "border-[#34d399]/50 text-[#34d399]" : "border-neutral-700 text-neutral-400 hover:border-[#34d399] hover:text-[#34d399]"}`}>{done.has(r.id) ? "✓ Done" : "Mark done"}</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
