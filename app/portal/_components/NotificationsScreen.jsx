"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

function rel(ts) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function NotificationsScreen({ me, onBack, onOpenTasks, onOpenDM }) {
  const [mentions, setMentions] = useState([]);
  const [anns, setAnns] = useState([]);
  const [subs, setSubs] = useState([]);
  const [exts, setExts] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [notifs, setNotifs] = useState([]); // persistent notifications table (072) — digest, cases, etc.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stop = false;
    Promise.all([
      supabase.from("mentions").select("*").eq("mentioned_user_id", me.id).order("created_at", { ascending: false }).limit(25),
      supabase.from("announcements").select("id,title,body,created_at").order("created_at", { ascending: false }).limit(15),
      supabase.from("submissions").select("id,task_id,status,feedback,graded_at,tasks(week,title)").eq("user_id", me.id).not("graded_at", "is", null).order("graded_at", { ascending: false }).limit(25),
      supabase.from("task_extension_requests").select("id,task_id,status,decided_at,extended_until,tasks(week,title)").eq("user_id", me.id).not("decided_at", "is", null).order("decided_at", { ascending: false }).limit(25),
      supabase.from("notifications").select("id,kind,title,body,link,read_at,created_at").eq("user_id", me.id).order("created_at", { ascending: false }).limit(30),
    ]).then(async ([m, a, s, e, n]) => {
      if (stop) return;
      const mentionRows = m.data || [];
      setMentions(mentionRows);
      setAnns(a.data || []);
      setSubs(s.data || []);
      setExts(e.data || []);
      setNotifs(n.data || []);
      const authorIds = [...new Set(mentionRows.map((row) => row.author_id).filter(Boolean))];
      if (authorIds.length) {
        const { data } = await supabase.from("public_profiles").select("id,display_name").in("id", authorIds);
        if (!stop) setProfiles(Object.fromEntries((data || []).map((p) => [p.id, p])));
      }
      if (!stop) setLoading(false);
    });
    return () => { stop = true; };
  }, [me.id]);

  const items = useMemo(() => {
    const list = [];
    mentions.forEach((m) => list.push({
      id: `mention:${m.id}`,
      type: m.kind === "reply" ? "reply" : "mention",
      title: m.kind === "reply" ? "Someone replied to you" : "You were mentioned",
      body: `${profiles[m.author_id]?.display_name || "Someone"}: ${m.content || ""}`,
      at: m.created_at,
      unread: !m.read,
    }));
    anns.forEach((a) => list.push({ id: `ann:${a.id}`, type: "announcement", title: a.title, body: a.body, at: a.created_at }));
    subs.forEach((s) => list.push({ id: `sub:${s.id}`, type: "grade", title: `Task ${s.status}`, body: `Week ${s.tasks?.week} - ${s.tasks?.title || "Task"}${s.feedback ? `: ${s.feedback}` : ""}`, at: s.graded_at, action: onOpenTasks }));
    exts.forEach((e) => list.push({ id: `ext:${e.id}`, type: "extension", title: `Extension ${e.status}`, body: `Week ${e.tasks?.week} - ${e.tasks?.title || "Task"}${e.extended_until ? ` until ${new Date(e.extended_until).toLocaleString()}` : ""}`, at: e.decided_at, action: onOpenTasks }));
    notifs.forEach((n) => list.push({ id: `notif:${n.id}`, type: n.kind === "digest" ? "grade" : "announcement", title: n.title, body: n.body, at: n.created_at, unread: !n.read_at }));
    return list.filter((i) => i.at).sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [mentions, anns, subs, exts, notifs, profiles, onOpenTasks]);

  async function markMentionsRead() {
    await supabase.from("mentions").update({ read: true }).eq("mentioned_user_id", me.id).eq("read", false);
    setMentions((rows) => rows.map((r) => ({ ...r, read: true })));
  }

  const tone = {
    mention: "border-blood/40 text-blood",
    reply: "border-[#38bdf8]/40 text-[#38bdf8]",
    announcement: "border-neutral-700 text-neutral-300",
    grade: "border-[#34d399]/40 text-[#34d399]",
    extension: "border-amber-500/40 text-amber-400",
  };

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Notification center</h1>
          <div className="flex items-center gap-2">
            {mentions.some((m) => !m.read) && <button onClick={markMentionsRead} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">Mark mentions read</button>}
            <button onClick={onOpenDM} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">DMs</button>
            <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">Back</button>
          </div>
        </div>
      </header>
      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 font-mono">
        {loading ? (
          <p className="text-center text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-16">Loading...</p>
        ) : items.length === 0 ? (
          <p className="text-center text-sm text-neutral-500 py-16">No notifications yet.</p>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <button key={item.id} type="button" onClick={item.action || undefined} className={`w-full text-left border rounded-sm p-4 bg-ink-900/30 hover:bg-ink-900/60 transition ${tone[item.type] || "border-neutral-800 text-neutral-400"}`}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[10px] uppercase tracking-widest">{item.type}</span>
                  <span className="text-[11px] text-neutral-600">{rel(item.at)}</span>
                </div>
                <h2 className="text-sm text-white mt-1">{item.title}</h2>
                {item.body && <p className="text-xs text-neutral-400 mt-1 line-clamp-2">{item.body}</p>}
                {item.unread && <span className="inline-block mt-2 h-1.5 w-1.5 rounded-full bg-blood" />}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
