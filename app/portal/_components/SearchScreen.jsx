"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function SearchScreen({ me, onBack, onOpenTasks, onOpenDocs, onOpenAdmin }) {
  const isAdmin = me.role === "admin";
  const [q, setQ] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stop = false;
    async function load() {
      const base = [
        supabase.from("tasks").select("id,week,title,description,due_at").order("week", { ascending: true }),
        supabase.from("announcements").select("id,title,body,created_at").order("created_at", { ascending: false }).limit(100),
      ];
      if (isAdmin) {
        base.push(
          supabase.from("profiles").select("id,display_name,full_name,email,member_id,role,status").limit(500),
          supabase.from("submissions").select("id,status,file_name,feedback,tasks(week,title),profiles!submissions_user_id_fkey(display_name,member_id)").limit(500)
        );
      } else {
        base.push(
          supabase.from("submissions").select("id,status,file_name,feedback,tasks(week,title)").eq("user_id", me.id),
          supabase.from("documents").select("id,type,file_name,created_at").eq("user_id", me.id),
          supabase.from("mentions").select("id,content,created_at").eq("mentioned_user_id", me.id).limit(100)
        );
      }
      const [results, resResp] = await Promise.all([
        Promise.all(base),
        // Phase 17: include the resource library in global search (published rows are member-visible).
        supabase.from("resources").select("id,title,description,kind,url").eq("is_published", true).limit(200),
      ]);
      if (stop) return;
      const [tasks, anns, third, fourth, fifth] = results;
      const rows = [];
      (tasks.data || []).forEach((t) => rows.push({ type: "task", title: `Week ${t.week} - ${t.title}`, body: t.description || "", action: onOpenTasks }));
      (anns.data || []).forEach((a) => rows.push({ type: "announcement", title: a.title, body: a.body || "" }));
      if (isAdmin) {
        (third.data || []).forEach((m) => rows.push({ type: "member", title: m.display_name || m.full_name || "Member", body: `${m.member_id || ""} ${m.email || ""} ${m.role || ""} ${m.status || ""}`, action: onOpenAdmin }));
        (fourth.data || []).forEach((s) => rows.push({ type: "submission", title: `${s.profiles?.display_name || "Student"} - W${s.tasks?.week} ${s.tasks?.title || ""}`, body: `${s.status || ""} ${s.file_name || ""} ${s.feedback || ""}`, action: onOpenAdmin }));
      } else {
        (third.data || []).forEach((s) => rows.push({ type: "submission", title: `W${s.tasks?.week} ${s.tasks?.title || "Task"} - ${s.status}`, body: `${s.file_name || ""} ${s.feedback || ""}`, action: onOpenTasks }));
        (fourth.data || []).forEach((d) => rows.push({ type: "document", title: d.file_name || d.type || "Document", body: d.type || "", action: onOpenDocs }));
        (fifth.data || []).forEach((m) => rows.push({ type: "mention", title: "Mention", body: m.content || "" }));
      }
      (resResp.data || []).forEach((r) => rows.push({
        type: "resource",
        title: r.title,
        body: `${r.kind || ""} ${r.description || ""}`.trim(),
        action: r.url ? () => window.open(r.url, "_blank", "noopener,noreferrer") : undefined,
      }));
      setItems(rows);
      setLoading(false);
    }
    load();
    return () => { stop = true; };
  }, [isAdmin, me.id, onOpenAdmin, onOpenDocs, onOpenTasks]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return items.slice(0, 40);
    return items.filter((item) => `${item.type} ${item.title} ${item.body}`.toLowerCase().includes(needle)).slice(0, 80);
  }, [items, q]);

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Search portal</h1>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">Back</button>
        </div>
      </header>
      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 font-mono">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks, resources, announcements, submissions, documents..."
          className="w-full panel border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm text-sm mb-4" />
        {loading ? (
          <p className="text-center text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-16">Indexing...</p>
        ) : results.length === 0 ? (
          <p className="text-center text-sm text-neutral-500 py-16">No results.</p>
        ) : (
          <div className="space-y-2">
            {results.map((item, i) => (
              <button key={i} type="button" onClick={item.action || undefined} className="w-full text-left border border-neutral-800 rounded-sm p-4 bg-ink-900/30 hover:bg-ink-900/60 hover:border-blood/30 transition">
                <span className="font-mono text-[10px] uppercase tracking-widest text-blood">{item.type}</span>
                <h2 className="text-sm text-white mt-1">{item.title}</h2>
                {item.body && <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{item.body}</p>}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
