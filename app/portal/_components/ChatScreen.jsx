"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DOMAIN_COLORS, initials, colorFor, fmtTime, containsAbuse, containsLink } from "../_lib";
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
        .select("id,content,created_at,deleted,user_id,link_status,is_pinned,pinned_at")
        .eq("domain_id", activeRoom.id)
        .order("created_at", { ascending: true });
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
    if (!isAdmin && containsAbuse(body)) {
      const timeoutUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await supabase.from("profiles").update({ timeout_until: timeoutUntil }).eq("id", me.id);
      setErr("⚠️ AutoMod: Abusive or NSFW language detected. You have been timed out for 10 minutes.");
      if (setMe) setMe((m) => ({ ...m, timeout_until: timeoutUntil }));
      return;
    }
    const isLink = !isAdmin && containsLink(body);
    const { error } = await supabase.from("messages").insert({
      domain_id: activeRoom.id,
      user_id: me.id,
      content: body,
      link_status: isLink ? "pending" : "approved",
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

  async function approveLink(id) {
    await supabase.from("messages").update({ link_status: "approved" }).eq("id", id);
  }

  async function rejectLink(id) {
    await supabase.from("messages").update({ link_status: "rejected", deleted: true }).eq("id", id);
  }

  async function togglePin(m) {
    await supabase.from("messages").update({
      is_pinned: !m.is_pinned,
      pinned_at: !m.is_pinned ? new Date().toISOString() : null,
    }).eq("id", m.id);
  }

  const typingNames = useMemo(() => Object.values(typing).map((t) => t.name), [typing]);

  const visibleMessages = useMemo(() => {
    return messages.filter((m) => {
      if (m.link_status === "pending") {
        if (!isAdmin && m.user_id !== me.id) return false;
      }
      if (m.link_status === "rejected" && !isAdmin) return false;
      return true;
    });
  }, [messages, isAdmin, me.id]);

  const pinnedMessages = useMemo(() => {
    return visibleMessages.filter((m) => m.is_pinned && !m.deleted);
  }, [visibleMessages]);

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
            {!isAdmin && !me.is_alumni && (
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
              {pinnedMessages.length > 0 && (
                <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-2.5 flex flex-col gap-1.5 shrink-0 backdrop-blur-md">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      📌 PINNED MESSAGES ({pinnedMessages.length})
                    </span>
                  </div>
                  <div className="max-h-24 overflow-y-auto space-y-1 divide-y divide-amber-500/10 pr-1">
                    {pinnedMessages.map((pm) => (
                      <div key={pm.id} className="pt-1 text-xs text-neutral-200 flex items-center justify-between gap-2">
                        <span className="truncate flex-1 font-mono">
                          <strong className="text-amber-300">{pm.profiles?.display_name || "Unknown"}: </strong>
                          {pm.content}
                        </span>
                        {isAdmin && (
                          <button onClick={() => togglePin(pm)} className="text-[10px] font-mono uppercase text-amber-400 hover:underline shrink-0">unpin</button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[calc(100vh-170px)]">
                {loading && <p className="font-mono text-xs text-neutral-600">Decryption in progress...</p>}
                {!loading && !visibleMessages.length && <p className="font-mono text-xs text-neutral-600">No signals intercepted yet.</p>}
                {visibleMessages.map((m) => (
                  <Message key={m.id} m={m} isAdmin={isAdmin} onDelete={softDelete} onTogglePin={togglePin} onApproveLink={approveLink} onRejectLink={rejectLink} />
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

function Message({ m, isAdmin, onDelete, onTogglePin, onApproveLink, onRejectLink }) {
  const p = m.profiles || {};
  return (
    <div className="group flex items-start gap-3">
      <MiniAvatar p={p} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-sm text-white">{p.display_name || "Unknown"}</span>
          {p.role === "admin" && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-blood text-ink-950">Admin</span>
          )}
          {p.is_alumni && p.role !== "admin" && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-[#38bdf8] text-ink-950">Alumni 🎓</span>
          )}
          {m.is_pinned && !m.deleted && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-amber-500 text-ink-950 font-bold shadow-sm">
              📌 Pinned
            </span>
          )}
          <span className="font-mono text-[10px] text-neutral-600">{fmtTime(m.created_at)}</span>
          {isAdmin && !m.deleted && (
            <>
              <button onClick={() => onTogglePin(m)} className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-amber-400 transition">
                {m.is_pinned ? "unpin" : "pin"}
              </button>
              <button onClick={() => onDelete(m.id)} className="opacity-0 group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-blood transition">
                delete
              </button>
            </>
          )}
        </div>
        {m.link_status === "pending" && !m.deleted && (
          <div className="my-1.5 p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-sm flex items-center justify-between gap-3 text-xs font-mono">
            <span className="text-amber-400">
              {isAdmin ? "🔗 LINK PENDING APPROVAL (Preview link before publishing)" : "⏳ (wait for admin approval to publish link)"}
            </span>
            {isAdmin && (
              <div className="flex gap-2 shrink-0">
                <button onClick={() => onApproveLink(m.id)} className="bg-emerald-500 text-ink-950 px-2.5 py-1 rounded-sm font-bold uppercase text-[10px] tracking-wider hover:bg-emerald-400 transition">Approve</button>
                <button onClick={() => onRejectLink(m.id)} className="bg-blood text-ink-950 px-2.5 py-1 rounded-sm font-bold uppercase text-[10px] tracking-wider hover:bg-blood-glow transition">Reject</button>
              </div>
            )}
          </div>
        )}
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
