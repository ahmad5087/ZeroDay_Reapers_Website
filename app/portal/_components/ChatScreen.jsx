"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DOMAIN_COLORS, initials, colorFor, fmtTime } from "../_lib";
import AnnouncementsChannel from "./AnnouncementsChannel";

// Special read-only "room" for the announcements feed (not a real domain).
const ANN_ROOM = { id: "ann", key: "ann", name: "📢 Announcements" };

export default function ChatScreen({ me, setMe, online = new Set(), onSignOut, onOpenAdmin, onOpenTasks, onOpenDocs, onOpenDM, onOpenProfile }) {
  const isAdmin = me.role === "admin";
  const timedOut = me.timeout_until && new Date(me.timeout_until) > new Date();
  const [rooms, setRooms] = useState([]);
  const [activeRoom, setActiveRoom] = useState(null); // {id,key,name}
  const [messages, setMessages] = useState([]);
  const [members, setMembers] = useState([]);
  const [typing, setTyping] = useState({}); // id -> {name, at}
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const cache = useRef(new Map()); // user_id -> {display_name, role, avatar_url}
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const typingSentAt = useRef(0);

  // Rooms available: students get their domain + lobby; admins get every room; alumni get only Alumni Group.
  useEffect(() => {
    supabase.from("domains").select("id,key,name").order("sort").then(({ data }) => {
      const all = data || [];
      const domainRooms = isAdmin
        ? all
        : me.is_alumni
          ? [all.find((d) => d.key === "alumni")].filter(Boolean)
          : [all.find((d) => d.id === me.domain_id), all.find((d) => d.key === "lobby")].filter(Boolean);
      const full = [ANN_ROOM, ...domainRooms];
      setRooms(full);
      setActiveRoom((prev) => prev && full.some((r) => r.id === prev.id) ? prev : (domainRooms[0] || ANN_ROOM));
    });
  }, [me.domain_id, me.is_alumni, isAdmin]);

  function remember(p) {
    if (p) cache.current.set(p.id, { display_name: p.display_name, role: p.role, avatar_url: p.avatar_url, is_alumni: p.is_alumni });
  }

  async function senderOf(userId) {
    if (cache.current.has(userId)) return cache.current.get(userId);
    const { data } = await supabase.from("public_profiles").select("id,display_name,role,avatar_url,is_alumni").eq("id", userId).single();
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
    setErr("");
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
          .select("id,display_name,role,avatar_url,is_alumni").in("id", ids);
        (profs || []).forEach(remember);
      }
      if (cancelled) return;
      setMessages((msgs || []).map((m) => ({
        ...m,
        profiles: { id: m.user_id, ...(cache.current.get(m.user_id) || { display_name: "Unknown" }) },
      })));
      setLoading(false);

      // members of this room (for lobby, show everyone; for domain rooms, show domain students + all admins)
      let q = supabase.from("public_profiles").select("id,display_name,role,avatar_url,domain_id,is_alumni");
      if (activeRoom.key === "alumni") {
        q = q.or("is_alumni.eq.true,role.eq.admin");
      } else if (activeRoom.key !== "lobby") {
        q = q.or(`domain_id.eq.${activeRoom.id},role.eq.admin`);
      }
      const { data: mem } = await q;
      if (!cancelled) {
        const list = (mem || []).filter((p) => {
          if (p.role === "admin") return true;
          if (activeRoom.key === "alumni") return p.is_alumni;
          return !p.is_alumni; // in lobby and domain rooms, hide alumni!
        });
        setMembers(list);
      }
    })();

    const ch = supabase.channel("room:" + activeRoom.id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "domain_id=eq." + activeRoom.id },
        async ({ new: m }) => {
          const s = await senderOf(m.user_id);
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, { ...m, profiles: { id: m.user_id, ...s } }]);
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: "domain_id=eq." + activeRoom.id },
        ({ new: m }) => setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, deleted: m.deleted, content: m.content } : x)))
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (payload.id === me.id) return;
        setTyping((t) => ({ ...t, [payload.id]: { name: payload.name, at: Date.now() } }));
      })
      .subscribe();

    channelRef.current = ch;
    return () => { cancelled = true; supabase.removeChannel(ch); channelRef.current = null; };
  }, [activeRoom, me.id, me.display_name]);

  useEffect(() => {
    const iv = setInterval(() => {
      const now = Date.now();
      setTyping((old) => {
        const next = { ...old };
        let ch = false;
        Object.entries(next).forEach(([id, val]) => {
          if (now - val.at > 3500) { delete next[id]; ch = true; }
        });
        return ch ? next : old;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  async function send(e) {
    e.preventDefault();
    if (!text.trim() || !activeRoom) return;
    const body = text.trim();
    setText("");
    setErr("");
    const { error } = await supabase.from("messages").insert({
      domain_id: activeRoom.id,
      user_id: me.id,
      content: body,
    });
    if (error) setErr(error.message);
  }

  function handleInput(e) {
    setText(e.target.value);
    if (err) setErr("");
    const now = Date.now();
    if (now - typingSentAt.current > 2000 && channelRef.current) {
      typingSentAt.current = now;
      channelRef.current.send({ type: "broadcast", event: "typing", payload: { user_id: me.id, name: me.display_name } });
    }
  }

  async function softDelete(id) {
    await supabase.from("messages").update({ deleted: true }).eq("id", id);
  }

  const typingNames = useMemo(() => Object.values(typing).map((t) => t.name), [typing]);

  return (
    <div className="min-h-screen flex flex-col">
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
            {!me.is_alumni && (
              <button onClick={onOpenTasks} className="hidden sm:inline-block font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
                Tasks
              </button>
            )}
            {!isAdmin && !me.is_alumni && (
              <button onClick={onOpenDocs} className="hidden sm:inline-block font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
                Docs
              </button>
            )}
            <button onClick={onOpenProfile} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
              Profile
            </button>
            {isAdmin && (
              <button onClick={onOpenAdmin} className="font-mono text-xs uppercase tracking-widest border border-blood text-blood px-3 py-2 rounded-sm hover:bg-blood hover:text-ink-950 transition">
                Admin
              </button>
            )}
            <button onClick={onSignOut} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
              Log out
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto grid md:grid-cols-[1fr_240px] gap-0">
        <div className="flex flex-col min-h-[calc(100vh-57px)] border-r border-blood/10">
          <div className="flex gap-2 p-3 border-b border-blood/10 font-mono text-xs uppercase tracking-widest">
            {rooms.map((r) => (
              <button key={r.id} onClick={() => setActiveRoom(r)}
                className={`px-3 py-1.5 rounded-sm transition ${activeRoom?.id === r.id ? "bg-blood text-ink-950 font-bold" : "text-neutral-400 hover:text-white"}`}>
                {r.name}
              </button>
            ))}
          </div>

          {activeRoom?.key === "ann" ? (
            <AnnouncementsChannel me={me} />
          ) : (
            <>
              <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[calc(100vh-170px)]">
                {loading && <p className="font-mono text-xs text-neutral-600">Decryption in progress...</p>}
                {!loading && !messages.length && <p className="font-mono text-xs text-neutral-600">No signals intercepted yet.</p>}
                {messages.map((m) => (
                  <Message key={m.id} m={m} isAdmin={isAdmin} onDelete={softDelete} />
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="p-3 border-t border-blood/10 bg-black/40">
                {err && (
                  <div className="font-mono text-xs text-blood py-1.5 px-3 mb-2 bg-blood/10 border border-blood rounded-sm">
                    ⚠️ {err}
                  </div>
                )}
                {typingNames.length > 0 && (
                  <div className="font-mono text-[10px] text-blood/80 mb-1 tracking-widest animate-pulse">
                    {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} transmitting...
                  </div>
                )}
                {me.banned || timedOut ? (
                  <div className="font-mono text-xs text-blood py-2 text-center border border-blood/30 bg-blood/5">
                    {me.banned ? "TERMINAL ACCESS REVOKED." : `TEMPORARILY MUTED UNTIL ${new Date(me.timeout_until).toLocaleTimeString()}`}
                  </div>
                ) : (
                  <form onSubmit={send} className="flex gap-2">
                    <input type="text" value={text} onChange={handleInput} placeholder={`Transmit to #${activeRoom?.name || "room"}...`}
                      className="flex-1 bg-neutral-950 border border-neutral-800 rounded-sm px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-blood font-mono" />
                    <button type="submit" className="font-mono text-xs uppercase tracking-widest bg-blood text-ink-950 font-bold px-4 py-2 rounded-sm hover:bg-blood/90 transition">
                      Send
                    </button>
                  </form>
                )}
              </div>
            </>
          )}
        </div>

        <aside className="hidden md:block p-4 border-l border-blood/10 bg-black/40 space-y-6 overflow-y-auto">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-blood font-semibold mb-3 flex items-center gap-1.5">
              <span>Admins</span>
              <span className="text-[10px] bg-blood/20 text-blood px-1.5 py-0.5 rounded-sm">
                {members.filter((m) => m.role === "admin").length}
              </span>
            </div>
            <div className="space-y-2">
              {members
                .filter((mem) => mem.role === "admin")
                .map((mem) => (
                  <div key={mem.id} className="flex items-center gap-2">
                    <MiniAvatar p={mem} />
                    <span className="font-mono text-xs text-blood font-medium truncate">{mem.display_name}</span>
                    {online.has(mem.id) && <span className="ml-auto w-2 h-2 rounded-full bg-[#34d399]" title="online" />}
                  </div>
                ))}
            </div>
          </div>

          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3 flex items-center gap-1.5">
              <span>{activeRoom?.key === "alumni" ? "Alumni" : "Members"}</span>
              <span className="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded-sm">
                {members.filter((m) => m.role !== "admin").length}
              </span>
            </div>
            <div className="space-y-2">
              {members
                .filter((mem) => mem.role !== "admin")
                .map((mem) => (
                  <div key={mem.id} className="flex items-center gap-2">
                    <MiniAvatar p={mem} />
                    <span className="font-mono text-xs text-neutral-300 truncate">
                      {mem.display_name} {mem.is_alumni ? "🎓" : ""}
                    </span>
                    {online.has(mem.id) && <span className="ml-auto w-2 h-2 rounded-full bg-[#34d399]" title="online" />}
                  </div>
                ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Message({ m, isAdmin, onDelete }) {
  const p = m.profiles || {};
  return (
    <div className="group flex items-start gap-3">
      <MiniAvatar p={p} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-white">{p.display_name || "Unknown"}</span>
          {p.role === "admin" && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-blood text-ink-950">Admin</span>
          )}
          {p.is_alumni && p.role !== "admin" && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-[#38bdf8] text-ink-950">Alumni 🎓</span>
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
