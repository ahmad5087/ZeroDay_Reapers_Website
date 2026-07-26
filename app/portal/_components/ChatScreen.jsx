"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DOMAIN_COLORS, initials, colorFor, fmtTime } from "../_lib";
import AnnouncementsChannel from "./AnnouncementsChannel";

// Special read-only "room" for the announcements feed (not a real domain).
const ANN_ROOM = { id: "ann", key: "ann", name: "📢 Announcements" };

export default function ChatScreen({ me, setMe, onSignOut, onOpenAdmin, onOpenTasks, onOpenDocs, onOpenDM }) {
  const isAdmin = me.role === "admin";
  const timedOut = me.timeout_until && new Date(me.timeout_until) > new Date();
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null); // {id,key,name}
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [online, setOnline] = useState(new Set());
  const [typing, setTyping] = useState({}); // id -> {name, at}
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const cache = useRef(new Map()); // user_id -> {display_name, role, avatar_url}
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const typingSentAt = useRef(0);

  // Rooms available: students get their domain + lobby; admins get every room.
  useEffect(() => {
    supabase.from("domains").select("id,key,name").order("sort").then(({ data }) => {
      const all = data || [];
      const domainRooms = isAdmin
        ? all
        : [all.find((d) => d.id === me.domain_id), all.find((d) => d.key === "lobby")].filter(Boolean);
      const full = [ANN_ROOM, ...domainRooms];
      setRooms(full);
      setActiveRoom((prev) => prev && full.some((r) => r.id === prev.id) ? prev : (domainRooms[0] || ANN_ROOM));
    });
  }, [me.domain_id, isAdmin]);

  function remember(p) {
    if (p) cache.current.set(p.id, { display_name: p.display_name, role: p.role, avatar_url: p.avatar_url });
  }

  async function senderOf(userId) {
    if (cache.current.has(userId)) return cache.current.get(userId);
    const { data } = await supabase.from("public_profiles").select("id,display_name,role,avatar_url").eq("id", userId).single();
    if (data) remember(data);
    return cache.current.get(userId) || { display_name: "Unknown", role: "student" };
  }

  // Load history + subscribe (messages + presence + typing) whenever the room changes.
  useEffect(() => {
    if (!activeRoom) return;
    // Announcements is a separate feed component — skip the messages machinery.
    if (activeRoom.key === "ann") { setLoading(false); setMessages([]); setMembers([]); return; }
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setTyping({});

    (async () => {
      const { data: msgs } = await supabase
        .from("messages")
        .select("id,content,created_at,deleted,user_id")
        .eq("domain_id", activeRoom.id)
        .order("created_at", { ascending: true })
        .limit(200);
      if (cancelled) return;
      // Batch-fetch senders from the safe view (email/full_name stay private).
      const ids = [...new Set((msgs || []).map((m) => m.user_id))];
      if (ids.length) {
        const { data: profs } = await supabase.from("public_profiles")
          .select("id,display_name,role,avatar_url").in("id", ids);
        (profs || []).forEach(remember);
      }
      if (cancelled) return;
      setMessages((msgs || []).map((m) => ({
        ...m,
        profiles: { id: m.user_id, ...(cache.current.get(m.user_id) || { display_name: "Unknown" }) },
      })));
      setLoading(false);

      // members of this room (for lobby, show everyone)
      let q = supabase.from("public_profiles").select("id,display_name,role,avatar_url,domain_id");
      if (activeRoom.key !== "lobby") q = q.eq("domain_id", activeRoom.id);
      const { data: mem } = await q;
      if (!cancelled) setMembers(mem || []);
    })();

    const ch = supabase.channel("room:" + activeRoom.id, { config: { presence: { key: me.id } } })
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "domain_id=eq." + activeRoom.id },
        async ({ new: m }) => {
          const s = await senderOf(m.user_id);
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, { ...m, profiles: { id: m.user_id, ...s } }]);
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: "domain_id=eq." + activeRoom.id },
        ({ new: m }) => setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, deleted: m.deleted, content: m.content } : x)))
      .on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        setOnline(new Set(Object.keys(state)));
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.id === me.id) return;
        setTyping((t) => ({ ...t, [payload.id]: { name: payload.name, at: Date.now() } }));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") ch.track({ user_id: me.id, display_name: me.display_name });
      });

    channelRef.current = ch;
    return () => { cancelled = true; supabase.removeChannel(ch); channelRef.current = null; };
  }, [activeRoom, me.id, me.display_name]);

  // Expire stale typing indicators.
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = {};
        for (const [k, v] of Object.entries(prev)) if (now - v.at < 3000) next[k] = v;
        return next;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  function onType(e) {
    setText(e.target.value);
    const now = Date.now();
    if (channelRef.current && now - typingSentAt.current > 1200) {
      typingSentAt.current = now;
      channelRef.current.send({ type: "broadcast", event: "typing", payload: { id: me.id, name: me.display_name } });
    }
  }

  async function send(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content || me.banned || timedOut) return;
    setErr("");
    setText("");
    const { error } = await supabase.from("messages").insert({ domain_id: activeRoom.id, user_id: me.id, content });
    if (error) { setErr(error.message); setText(content); }
  }

  async function softDelete(id) {
    await supabase.from("messages").update({ deleted: true }).eq("id", id);
  }

  async function uploadAvatar(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop();
    const path = `${me.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) return setErr(upErr.message);
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = pub.publicUrl + "?t=" + Date.now();
    await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
    setMe((m) => ({ ...m, avatar_url: url }));
    cache.current.set(me.id, { display_name: me.display_name, role: me.role, avatar_url: url });
  }

  const typingNames = useMemo(() => Object.values(typing).map((t) => t.name), [typing]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-black border-b border-blood/20">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.svg" alt="" width={32} height={32} className="h-8 w-8" />
            <span className="font-mono text-xs md:text-sm tracking-widest text-white text-glow truncate">
              ZERO<span className="text-blood">DAY</span> REAPERS · PORTAL
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onOpenDM} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
              {isAdmin ? "DMs" : "Message Admin"}
            </button>
            <button onClick={onOpenTasks} className="hidden sm:inline-block font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
              Tasks
            </button>
            <button onClick={onOpenDocs} className="hidden sm:inline-block font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
              Docs
            </button>
            {isAdmin && (
              <button onClick={onOpenAdmin} className="font-mono text-xs uppercase tracking-widest border border-blood text-blood px-3 py-2 rounded-sm hover:bg-blood hover:text-ink-950 transition">
                Admin
              </button>
            )}
            <Avatar me={me} onUpload={uploadAvatar} />
            <button onClick={onSignOut} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto grid md:grid-cols-[1fr_240px] gap-0">
        {/* Chat column */}
        <div className="flex flex-col min-h-[calc(100vh-57px)] border-r border-blood/10">
          {/* Room tabs */}
          <div className="flex gap-2 p-3 border-b border-blood/10 font-mono text-xs uppercase tracking-widest">
            {rooms.map((r) => (
              <button key={r.id} onClick={() => setActiveRoom(r)}
                className={`px-3 py-2 rounded-sm transition ${activeRoom?.id === r.id ? "bg-blood text-ink-950" : "border border-neutral-700 text-neutral-400 hover:text-blood hover:border-blood"}`}>
                {r.name}
              </button>
            ))}
          </div>

          {activeRoom?.key === "ann" ? (
            <AnnouncementsChannel me={me} />
          ) : (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {loading ? (
                  <p className="font-mono text-xs text-neutral-500 animate-pulse">Loading messages…</p>
                ) : messages.length === 0 ? (
                  <p className="font-mono text-xs text-neutral-500">No messages yet. Say hello 👋</p>
                ) : (
                  messages.map((m) => (
                    <Message key={m.id} m={m} isAdmin={isAdmin} onDelete={softDelete} />
                  ))
                )}
                <div ref={bottomRef} />
              </div>

              {/* Typing + composer */}
              <div className="border-t border-blood/10 px-4 py-3">
                {typingNames.length > 0 && (
                  <p className="font-mono text-xs text-neutral-500 mb-2">
                    {typingNames.slice(0, 3).join(", ")} {typingNames.length === 1 ? "is" : "are"} typing…
                  </p>
                )}
                {err && <p className="font-mono text-xs text-blood mb-2">{err}</p>}
                {me.banned ? (
                  <p className="font-mono text-xs text-blood">You are muted by an admin and cannot post.</p>
                ) : timedOut ? (
                  <p className="font-mono text-xs text-blood">
                    You&apos;re timed out until {new Date(me.timeout_until).toLocaleString([], { timeStyle: "short", dateStyle: "short" })} — you can&apos;t post right now.
                  </p>
                ) : (
                  <form onSubmit={send} className="flex gap-2">
                    <input value={text} onChange={onType} placeholder={`Message ${activeRoom?.name || ""}…`}
                      className="flex-1 bg-ink-900 border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm font-mono text-sm" />
                    <button className="bg-blood text-ink-950 font-mono text-xs uppercase tracking-widest px-5 rounded-sm hover:bg-blood-glow transition">
                      Send
                    </button>
                  </form>
                )}
              </div>
            </>
          )}
        </div>

        {/* Members sidebar */}
        <aside className="hidden md:block p-4">
          <div className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3">
            Members ({members.length})
          </div>
          <div className="space-y-2">
            {members.map((mem) => (
              <div key={mem.id} className="flex items-center gap-2">
                <MiniAvatar p={mem} />
                <span className="font-mono text-xs text-neutral-300 truncate">{mem.display_name}</span>
                {online.has(mem.id) && <span className="ml-auto w-2 h-2 rounded-full bg-[#34d399]" title="online" />}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Message({ m, isAdmin, onDelete }) {
  const p = m.profiles || {};
  const badge = DOMAIN_COLORS[p.role === "admin" ? "offensive" : "lobby"];
  return (
    <div className="group flex items-start gap-3">
      <MiniAvatar p={p} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-white">{p.display_name || "Unknown"}</span>
          {p.role === "admin" && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-blood text-ink-950">Admin</span>
          )}
          <span className="font-mono text-[10px] text-neutral-600">{fmtTime(m.created_at)}</span>
          {isAdmin && !m.deleted && (
            <button onClick={() => onDelete(m.id)} className="opacity-0 group-hover:opacity-100 text-[10px] text-neutral-500 hover:text-blood transition">
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
  );
}

function MiniAvatar({ p = {} }) {
  if (p.avatar_url) {
    return <img src={p.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" />;
  }
  return (
    <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center font-mono text-xs text-white"
      style={{ background: colorFor(p.id || p.display_name || "") }}>
      {initials(p.display_name)}
    </div>
  );
}

function Avatar({ me, onUpload }) {
  return (
    <label className="cursor-pointer" title="Change avatar">
      <input type="file" accept="image/*" className="hidden" onChange={onUpload} />
      <MiniAvatar p={me} />
    </label>
  );
}
