"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { initials, colorFor, fmtTime, containsAbuse } from "../_lib";
import { ReactionRow, ReplyQuote, ReplyBanner } from "./ChatBits";

export default function DMScreen({ me, onBack }) {
  const isAdmin = me.role === "admin";
  const [threads, setThreads] = useState([]);   // admin: [{student_id, name, avatar_url, lastAt}]
  const [members, setMembers] = useState([]);    // admin: for starting a new DM
  const [active, setActive] = useState(isAdmin ? null : me.id); // open thread's student_id
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [typing, setTyping] = useState({}); // sender_id -> { name, at }
  const [reactions, setReactions] = useState({}); // dm_message_id -> [{user_id, emoji}]
  const [threadUnread, setThreadUnread] = useState({}); // admin: student_id -> unread count
  const [replyingTo, setReplyingTo] = useState(null);
  const [picker, setPicker] = useState(null);
  const names = useRef(new Map()); // id -> {display_name, role, avatar_url}
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const typingSentAt = useRef(0);

  function remember(p) { if (p) names.current.set(p.id, p); }

  // Admin: build the thread list from all DM rows + a member picker.
  async function loadThreads() {
    const { data: rows } = await supabase.from("dm_messages")
      .select("student_id,sender_id,seen_at,created_at").order("created_at", { ascending: false });
    const seen = new Map();
    const unread = {};
    (rows || []).forEach((r) => {
      if (!seen.has(r.student_id)) seen.set(r.student_id, r.created_at);
      // a student's own message not yet seen by any admin = unread for the admin side
      if (r.sender_id === r.student_id && !r.seen_at) unread[r.student_id] = (unread[r.student_id] || 0) + 1;
    });
    setThreadUnread(unread);
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
    setReactions({});
    (async () => {
      const { data } = await supabase.from("dm_messages").select("*").eq("student_id", active).order("created_at", { ascending: true });
      if (cancelled) return;
      const ids = [...new Set((data || []).map((m) => m.sender_id))].filter((id) => !names.current.has(id));
      if (ids.length) {
        const { data: profs } = await supabase.from("public_profiles").select("id,display_name,role,avatar_url").in("id", ids);
        (profs || []).forEach(remember);
      }
      if (!cancelled) setMessages(data || []);
      // Opening the thread marks the other party's messages as seen (read receipt + clears my unread).
      supabase.rpc("mark_dm_seen", { p_student_id: active }).then(() => { if (isAdmin) loadThreads(); });
      const msgIds = (data || []).map((m) => m.id);
      if (msgIds.length) {
        const { data: rx } = await supabase.from("dm_reactions").select("dm_message_id,user_id,emoji").in("dm_message_id", msgIds);
        if (!cancelled) {
          const map = {};
          (rx || []).forEach((r) => { if (!map[r.dm_message_id]) map[r.dm_message_id] = []; map[r.dm_message_id].push({ user_id: r.user_id, emoji: r.emoji }); });
          setReactions(map);
        }
      }
    })();

    const ch = supabase.channel("dm:" + active)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "dm_messages", filter: "student_id=eq." + active },
        async ({ new: m }) => {
          if (!names.current.has(m.sender_id)) {
            const { data: prof } = await supabase.from("public_profiles").select("id,display_name,role,avatar_url").eq("id", m.sender_id).single();
            remember(prof);
          }
          setMessages((p) => p.some((x) => x.id === m.id) ? p : [...p, m]);
          // I'm viewing this thread → an incoming message from the other party is immediately seen.
          if (m.sender_id !== me.id) supabase.rpc("mark_dm_seen", { p_student_id: active });
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "dm_messages", filter: "student_id=eq." + active },
        ({ new: m }) => setMessages((p) => p.map((x) => x.id === m.id ? m : x)))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "dm_reactions" },
        (payload) => {
          const isDel = payload.eventType === "DELETE";
          const row = isDel ? payload.old : payload.new;
          if (!row?.dm_message_id) return;
          setReactions((prev) => {
            const list = (prev[row.dm_message_id] || []).filter((r) => !(r.user_id === row.user_id && r.emoji === row.emoji));
            if (!isDel) list.push({ user_id: row.user_id, emoji: row.emoji });
            return { ...prev, [row.dm_message_id]: list };
          });
        })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload || payload.user_id === me.id) return;
        setTyping((p) => ({ ...p, [payload.user_id]: { name: payload.name, at: Date.now() } }));
      })
      .subscribe();
    channelRef.current = ch;
    return () => { cancelled = true; supabase.removeChannel(ch); channelRef.current = null; setTyping({}); };
  }, [active]);

  // Expire stale typing indicators (no fresh ping within 4s).
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((p) => {
        const now = Date.now();
        let changed = false;
        const next = {};
        for (const k in p) { if (now - p[k].at < 4000) next[k] = p[k]; else changed = true; }
        return changed ? next : p;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);

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
  async function toggleReaction(dmId, emoji) {
    const mine = (reactions[dmId] || []).some((r) => r.user_id === me.id && r.emoji === emoji);
    setReactions((prev) => {
      const list = (prev[dmId] || []).filter((r) => !(r.user_id === me.id && r.emoji === emoji));
      if (!mine) list.push({ user_id: me.id, emoji });
      return { ...prev, [dmId]: list };
    });
    if (mine) {
      await supabase.from("dm_reactions").delete().eq("dm_message_id", dmId).eq("user_id", me.id).eq("emoji", emoji);
    } else {
      await supabase.from("dm_reactions").insert({ dm_message_id: dmId, user_id: me.id, emoji });
    }
  }
  function jumpToDm(id) {
    const el = document.getElementById("dm-" + id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-amber-400", "rounded-sm");
    setTimeout(() => el.classList.remove("ring-2", "ring-amber-400", "rounded-sm"), 2500);
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
    const { error } = await supabase.from("dm_messages").insert({ student_id: active, sender_id: me.id, content, reply_to: replyingTo?.id || null });
    if (error) { setErr(error.message); setText(content); } else { setReplyingTo(null); }
  }

  function onType(e) {
    setText(e.target.value);
    const now = Date.now();
    if (active && channelRef.current && now - typingSentAt.current > 2000) {
      typingSentAt.current = now;
      // Students appear to admins by name; admins appear to students generically as "Admin".
      channelRef.current.send({
        type: "broadcast", event: "typing",
        payload: { user_id: me.id, name: isAdmin ? "Admin" : (me.display_name || "Someone") },
      });
    }
  }

  function nameOf(id) {
    if (id === me.id) return "You";
    if (!isAdmin) return "Admin";
    return names.current.get(id)?.display_name || (id === active ? "Student" : "Admin");
  }
  function isAdminSender(id) {
    if (id === me.id) return isAdmin;
    if (!isAdmin) return true;
    return id !== active || names.current.get(id)?.role === "admin";
  }
  function avatarOf(id) {
    const cached = names.current.get(id);
    if (cached) return cached;
    if (id === me.id) return me;
    if (!isAdmin || id !== active) return { display_name: "Admin", role: "admin" };
    return { display_name: "Student" };
  }

  const typingNames = Object.entries(typing).filter(([id]) => id !== me.id).map(([, v]) => v.name);
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

      <div className={`flex-1 max-w-6xl w-full mx-auto grid grid-cols-1 ${isAdmin ? "md:grid-cols-[260px_minmax(0,1fr)]" : ""} gap-0 min-w-0`}>
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
                  <span className="font-mono text-xs text-neutral-300 truncate flex-1">{t.display_name || "Unknown"}</span>
                  {threadUnread[t.student_id] > 0 && (
                    <span className="shrink-0 bg-blood text-ink-950 text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                      {threadUnread[t.student_id] > 9 ? "9+" : threadUnread[t.student_id]}
                    </span>
                  )}
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
              <div key={m.id} id={"dm-" + m.id} className="flex items-start gap-3 group transition-shadow">
                <Avatar p={avatarOf(m.sender_id)} />
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
                    {!m.deleted && (
                      <>
                        <button onClick={() => setReplyingTo({ id: m.id, authorName: m.sender_id === me.id ? "You" : nameOf(m.sender_id), content: m.content })} className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-blood transition">reply</button>
                        <button onClick={() => setPicker(m.id)} className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-amber-400 transition">react</button>
                      </>
                    )}
                  </div>
                  {m.reply_to && !m.deleted && (() => {
                    const parent = messages.find((x) => x.id === m.reply_to);
                    return <ReplyQuote authorName={parent ? (parent.sender_id === me.id ? "You" : nameOf(parent.sender_id)) : null} content={parent ? parent.content : "original message"} onJump={() => jumpToDm(m.reply_to)} />;
                  })()}
                  {m.deleted ? (
                    <p className="text-sm text-neutral-600 italic">message removed</p>
                  ) : (
                    <p className="text-sm text-neutral-300 break-words whitespace-pre-wrap">{m.content}</p>
                  )}
                  {!m.deleted && (
                    <ReactionRow messageId={m.id} reactions={reactions[m.id]} meId={me.id} onToggle={toggleReaction} pickerOpen={picker === m.id} onClosePicker={() => setPicker(null)} />
                  )}
                  {!m.deleted && m.sender_id === me.id && (
                    <span className={`font-mono text-[10px] ${m.seen_at ? "text-[#34d399]" : "text-neutral-600"}`} title={m.seen_at ? new Date(m.seen_at).toLocaleString() : ""}>
                      {m.seen_at ? "✓✓ Seen" : "✓ Received"}
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-blood/10 px-4 py-3">
            {typingNames.length > 0 && (
              <p className="font-mono text-[11px] text-neutral-500 mb-2 animate-pulse">
                {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…
              </p>
            )}
            {err && <p className="font-mono text-xs text-blood mb-2">{err}</p>}
            {replyingTo && (
              <ReplyBanner authorName={replyingTo.authorName} content={replyingTo.content} onCancel={() => setReplyingTo(null)} />
            )}
            <form onSubmit={send} className="flex gap-2">
              <input value={text} onChange={onType} disabled={!active}
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
