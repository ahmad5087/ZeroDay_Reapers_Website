"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { initials, colorFor, fmtTime, containsAbuse } from "../_lib";

export default function DMScreen({ me, onBack }) {
  const isAdmin = me.role === "admin";
  const [threads, setThreads] = useState([]);   // admin: [{student_id, name, avatar_url, lastAt}]
  const [members, setMembers] = useState([]);    // admin: for starting a new DM
  const [active, setActive] = useState(isAdmin ? null : me.id); // open thread's student_id
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const names = useRef(new Map()); // id -> {display_name, role, avatar_url}
  const bottomRef = useRef(null);

  function remember(p) { if (p) names.current.set(p.id, p); }

  // Admin: build the thread list from all DM rows + a member picker.
  async function loadThreads() {
    const { data: rows } = await supabase.from("dm_messages")
      .select("student_id,created_at").order("created_at", { ascending: false });
    const seen = new Map();
    (rows || []).forEach((r) => { if (!seen.has(r.student_id)) seen.set(r.student_id, r.created_at); });
    const ids = [...seen.keys()];
    if (ids.length) {
      const { data: profs } = await supabase.from("public_profiles").select("id,display_name,role,avatar_url").in("id", ids);
      (profs || []).forEach(remember);
    }
    setThreads(ids.map((id) => ({ student_id: id, lastAt: seen.get(id), ...(names.current.get(id) || {}) })));
    const { data: mem } = await supabase.from("public_profiles").select("id,display_name,role,avatar_url").neq("role", "admin");
    (mem || []).forEach(remember);
    setMembers(mem || []);
  }

  useEffect(() => { if (isAdmin) loadThreads(); }, []);

  // Load + subscribe to the active thread.
  useEffect(() => {
    if (!active) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("dm_messages").select("*").eq("student_id", active).order("created_at", { ascending: true });
      if (cancelled) return;
      const ids = [...new Set((data || []).map((m) => m.sender_id))].filter((id) => !names.current.has(id));
      if (ids.length) {
        const { data: profs } = await supabase.from("public_profiles").select("id,display_name,role,avatar_url").in("id", ids);
        (profs || []).forEach(remember);
      }
      if (!cancelled) setMessages(data || []);
    })();

    const ch = supabase.channel("dm:" + active)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages", filter: "student_id=eq." + active },
        ({ new: m }) => setMessages((p) => p.some((x) => x.id === m.id) ? p : [...p, m]))
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "dm_messages", filter: "student_id=eq." + active },
        ({ new: m }) => setMessages((p) => p.map((x) => x.id === m.id ? m : x)))
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [active]);

  // Admin: keep the thread list fresh on any new DM.
  useEffect(() => {
    if (!isAdmin) return;
    const ch = supabase.channel("dm-threads")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "dm_messages" }, () => loadThreads())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [isAdmin]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function softDelete(id) {
    await supabase.from("dm_messages").update({ deleted: true }).eq("id", id);
  }

  async function send(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content || !active) return;
    setErr(""); setText("");
    if (!isAdmin && containsAbuse(content)) {
      const timeoutUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await supabase.from("profiles").update({ timeout_until: timeoutUntil }).eq("id", me.id);
      setErr("⚠️ AutoMod: Abusive or NSFW language detected. You have been timed out for 10 minutes.");
      return;
    }
    const { error } = await supabase.from("dm_messages").insert({ student_id: active, sender_id: me.id, content });
    if (error) { setErr(error.message); setText(content); }
  }

  function nameOf(id) { return names.current.get(id)?.display_name || (id === me.id ? "You" : "Unknown"); }
  function isAdminSender(id) { return names.current.get(id)?.role === "admin"; }

  const activeName = isAdmin ? (names.current.get(active)?.display_name || "Select a conversation") : "Admins";

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-black border-b border-blood/20">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <span className="font-mono text-sm tracking-widest text-white text-glow">
            {isAdmin ? "DIRECT MESSAGES" : "MESSAGE THE ADMINS"}
          </span>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back to chat
          </button>
        </div>
      </header>

      <div className={`flex-1 max-w-6xl w-full mx-auto grid ${isAdmin ? "md:grid-cols-[260px_1fr]" : "grid-cols-1"} gap-0`}>
        {/* Admin: thread list + start new */}
        {isAdmin && (
          <aside className="border-r border-blood/10 p-3 space-y-4 overflow-y-auto">
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Conversations</div>
              {threads.length === 0 ? (
                <p className="font-mono text-xs text-neutral-600">No DMs yet.</p>
              ) : threads.map((t) => (
                <button key={t.student_id} onClick={() => setActive(t.student_id)}
                  className={`w-full flex items-center gap-2 px-2 py-2 rounded-sm text-left ${active === t.student_id ? "bg-blood/20" : "hover:bg-ink-900"}`}>
                  <Avatar p={t} />
                  <span className="font-mono text-xs text-neutral-300 truncate">{t.display_name || "Unknown"}</span>
                </button>
              ))}
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Start a DM</div>
              <select className="w-full bg-ink-900 border border-blood/30 focus:border-blood outline-none px-2 py-2 text-neutral-100 rounded-sm font-mono text-xs"
                value="" onChange={(e) => e.target.value && setActive(e.target.value)}>
                <option value="">Pick a member…</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}
              </select>
            </div>
          </aside>
        )}

        {/* Conversation */}
        <div className="flex flex-col min-h-[calc(100vh-57px)]">
          {isAdmin && (
            <div className="px-4 py-2 border-b border-blood/10 font-mono text-xs text-neutral-400">{activeName}</div>
          )}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {!active ? (
              <p className="font-mono text-xs text-neutral-500">Select a conversation.</p>
            ) : messages.length === 0 ? (
              <p className="font-mono text-xs text-neutral-500">
                {isAdmin ? "No messages yet — say hello." : "Send a message to the admins. Only admins can see this."}
              </p>
            ) : messages.map((m) => (
              <div key={m.id} className="flex items-start gap-3 group">
                <Avatar p={names.current.get(m.sender_id)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm text-white">{m.sender_id === me.id ? "You" : nameOf(m.sender_id)}</span>
                    {isAdminSender(m.sender_id) && <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-blood text-ink-950">Admin</span>}
                    <span className="font-mono text-[10px] text-neutral-600">{fmtTime(m.created_at)}</span>
                    {isAdmin && !m.deleted && (
                      <button onClick={() => softDelete(m.id)} className="opacity-0 group-hover:opacity-100 text-[10px] text-neutral-500 hover:text-blood transition">
                        delete
                      </button>
                    )}
                  </div>
                  {m.deleted ? (
                    <p className="text-sm text-neutral-600 italic">message removed</p>
                  ) : (
                    <p className="text-sm text-neutral-300 break-words whitespace-pre-wrap">{m.content}</p>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-blood/10 px-4 py-3">
            {err && <p className="font-mono text-xs text-blood mb-2">{err}</p>}
            <form onSubmit={send} className="flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)} disabled={!active}
                placeholder={active ? "Type a message…" : "Select a conversation first"}
                className="flex-1 bg-ink-900 border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm font-mono text-sm disabled:opacity-50" />
              <button disabled={!active} className="bg-blood text-ink-950 font-mono text-xs uppercase tracking-widest px-5 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function Avatar({ p = {} }) {
  if (p?.avatar_url) return <img src={p.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />;
  return (
    <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center font-mono text-xs text-white"
      style={{ background: colorFor(p?.id || p?.display_name || "") }}>
      {initials(p?.display_name)}
    </div>
  );
}
