"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { DOMAIN_COLORS, initials, colorFor, fmtTime, containsAbuse, containsLink } from "../_lib";
import dynamic from "next/dynamic";
import Flag from "@/app/_components/Flag";
import { uploadToR2, downloadFromR2 } from "@/lib/r2client";
import AnnouncementsChannel from "./AnnouncementsChannel";
import MilestonesChannel from "./MilestonesChannel";
import PortalMenu from "./PortalMenu";
import { ReactionRow, ReplyQuote, ReplyBanner } from "./ChatBits";
import { renderMessageContent, firstLink, LinkPreview } from "./LinkPreview";

const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

// Special read-only "rooms" (not real domains): the announcements feed and the milestones board.
const ANN_ROOM = { id: "ann", key: "ann", name: "📢 Announcements" };
const MILESTONES_ROOM = { id: "milestones", key: "milestones", name: "🏆 Milestones" };

// Emoji icon for a chat attachment based on its extension.
function fileIcon(name = "") {
  const e = (name.split(".").pop() || "").toLowerCase();
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(e)) return "🖼️";
  if (e === "pdf") return "📕";
  if (e === "docx" || e === "doc") return "📘";
  if (e === "txt") return "📄";
  return "📎";
}

export default function ChatScreen({ me, setMe, online = new Set(), onSignOut, onOpenAdmin, onOpenTasks, onOpenDocs, onOpenDM, onOpenProfile, onOpenDashboard, onOpenCalendar, onOpenActivity, onOpenFeedback }) {
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

  const [mentionQuery, setMentionQuery] = useState(null); // active "@query" for autocomplete, or null
  const [unreadMentions, setUnreadMentions] = useState(0);
  const [mentions, setMentions] = useState([]);          // recent mention rows for the bell dropdown
  const [dmUnread, setDmUnread] = useState(0);           // unread DM count for the nav badge
  const [pendingScroll, setPendingScroll] = useState(null); // message id to scroll to (from a mention)
  const [deptById, setDeptById] = useState({});     // domain_id -> { code, color } for the dept tag
  const [reactions, setReactions] = useState({});     // message_id -> [{user_id, emoji}]
  const [replyingTo, setReplyingTo] = useState(null);  // { id, authorName, content } — composing a reply
  const [picker, setPicker] = useState(null);          // message id with an open emoji picker
  const [composerPicker, setComposerPicker] = useState(false); // composer emoji picker open
  const [attaching, setAttaching] = useState(false);   // uploading a chat attachment
  const [roomCounts, setRoomCounts] = useState({}); // admin-only: user_id -> messages in this room
  const [leftOpen, setLeftOpen] = useState(true);   // desktop channels sidebar expanded/collapsed
  const [rightOpen, setRightOpen] = useState(true);  // desktop members sidebar expanded/collapsed
  const [hidden, setHidden] = useState(() => new Set()); // message_ids I've "deleted for me"
  const [clearedAt, setClearedAt] = useState(null);      // my "clear chat" watermark for this room
  const [msgInfo, setMsgInfo] = useState(null);          // { m, seen, unseen } — Message Info modal
  const [leftW, setLeftW] = useState(220);               // desktop channels panel width (px)
  const [rightW, setRightW] = useState(240);             // desktop members panel width (px)
  const [dragging, setDragging] = useState(null);        // "left" | "right" | null while resizing
  const [isDesktop, setIsDesktop] = useState(false);
  const [mounted, setMounted] = useState(false);

  const cache = useRef(new Map()); // user_id -> {display_name, role, avatar_url}
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const typingSentAt = useRef(0);
  const inputRef = useRef(null);
  const audioCtxRef = useRef(null);
  const selectedMentions = useRef(new Map()); // lowercased display_name -> user_id (picked this compose)

  // Short beep via Web Audio (no asset needed) when someone @mentions you.
  function beep() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = audioCtxRef.current || (audioCtxRef.current = new AC());
      if (ctx.state === "suspended") ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.type = "sine"; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
      o.start(); o.stop(ctx.currentTime + 0.26);
    } catch { /* ignore audio errors */ }
  }

  // Rooms available: students get their domain + lobby; admins get every room; alumni get only Alumni Group.
  useEffect(() => {
    supabase.from("domains").select("id,key,name").order("sort").then(({ data }) => {
      const all = data || [];
      const DEPT = { offensive: "OS", defensive: "DS", cloud: "CS", grc: "GRC", forensics: "DF", ai: "AIS" };
      const map = {};
      all.forEach((d) => { if (DEPT[d.key]) map[d.id] = { code: DEPT[d.key], color: DOMAIN_COLORS[d.key] || "#22d3ee" }; });
      setDeptById(map);
      const domainRooms = isAdmin
        ? all
        : me.is_alumni
          ? [all.find((d) => d.key === "alumni")].filter(Boolean)
          : [all.find((d) => d.id === me.domain_id), all.find((d) => d.key === "lobby")].filter(Boolean);
      const full = [ANN_ROOM, MILESTONES_ROOM, ...domainRooms];
      setRooms(full);
      setActiveRoom((prev) => prev && full.some((r) => r.id === prev.id) ? prev : (domainRooms[0] || ANN_ROOM));
    });
  }, [me.domain_id, me.is_alumni, isAdmin]);

  function remember(p) {
    if (p) cache.current.set(p.id, { display_name: p.display_name, role: p.role, avatar_url: p.avatar_url, is_alumni: p.is_alumni, domain_id: p.domain_id });
  }

  async function senderOf(userId) {
    if (cache.current.has(userId)) return cache.current.get(userId);
    const { data } = await supabase.from("public_profiles").select("id,display_name,role,avatar_url,is_alumni,country,domain_id").eq("id", userId).single();
    if (data) remember(data);
    return cache.current.get(userId) || { display_name: "Unknown", role: "student" };
  }

  // Load history + subscribe (messages + presence + typing) whenever the room changes.
  useEffect(() => {
    if (!activeRoom) return;
    // Announcements is a separate feed component — skip the messages machinery.
    if (activeRoom.key === "ann" || activeRoom.key === "milestones") { setLoading(false); setMessages([]); setMembers([]); return; }
    let cancelled = false;
    setLoading(true);
    setErr("");
    setMessages([]);
    setReactions({});
    setTyping({});

    (async () => {
      const { data: msgs } = await supabase
        .from("messages")
        .select("id,content,created_at,deleted,user_id,link_status,is_pinned,pinned_at,reply_to,file_key,file_name")
        .eq("domain_id", activeRoom.id)
        .eq("deleted", false)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      // Batch-fetch senders from the safe view (email/full_name stay private).
      const ids = [...new Set((msgs || []).map((m) => m.user_id))];
      if (ids.length) {
        const { data: profs } = await supabase.from("public_profiles")
          .select("id,display_name,role,avatar_url,is_alumni,country,domain_id").in("id", ids);
        (profs || []).forEach(remember);
      }
      if (cancelled) return;
      setMessages((msgs || []).map((m) => ({
        ...m,
        profiles: { id: m.user_id, ...(cache.current.get(m.user_id) || { display_name: "Unknown" }) },
      })));
      setLoading(false);

      // Reactions for the loaded messages.
      const msgIds = (msgs || []).map((m) => m.id);
      if (msgIds.length) {
        const { data: rx } = await supabase.from("message_reactions").select("message_id,user_id,emoji").in("message_id", msgIds);
        if (!cancelled) {
          const map = {};
          (rx || []).forEach((r) => { if (!map[r.message_id]) map[r.message_id] = []; map[r.message_id].push({ user_id: r.user_id, emoji: r.emoji }); });
          setReactions(map);
        }
      }

      // Per-user chat privacy: which of these messages I've hidden ("delete for me") + my "clear chat" watermark.
      if (msgIds.length) {
        const { data: hides } = await supabase.from("message_hides").select("message_id").eq("user_id", me.id).in("message_id", msgIds);
        if (!cancelled) setHidden(new Set((hides || []).map((h) => h.message_id)));
      } else if (!cancelled) { setHidden(new Set()); }
      const { data: rc } = await supabase.from("room_clears").select("cleared_at").eq("user_id", me.id).eq("domain_id", activeRoom.id).maybeSingle();
      if (!cancelled) setClearedAt(rc?.cleared_at || null);
      // Mark this room read now (this drives everyone else's "message info" seen list).
      supabase.rpc("mark_room_read", { p_domain_id: activeRoom.id });

      // members of this room (for lobby, show everyone; for domain rooms, show domain students + all admins)
      // select("*") (not an explicit column list) so this keeps working even before migration 044
      // adds linkedin_url to the public_profiles view — a missing named column would 400 the query.
      let q = supabase.from("public_profiles").select("*");
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

      // Admin-only: per-member message counts for this room.
      if (isAdmin) {
        const { data: counts } = await supabase.rpc("room_message_counts", { p_domain_id: activeRoom.id });
        if (!cancelled) {
          const map = {};
          (counts || []).forEach((c) => { map[c.user_id] = Number(c.cnt); });
          setRoomCounts(map);
        }
      } else if (!cancelled) {
        setRoomCounts({});
      }
    })();

    const ch = supabase.channel("room:" + activeRoom.id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: "domain_id=eq." + activeRoom.id },
        async ({ new: m }) => {
          const s = await senderOf(m.user_id);
          setMessages((prev) => prev.some((x) => x.id === m.id) ? prev : [...prev, { ...m, profiles: { id: m.user_id, ...s } }]);
          supabase.rpc("mark_room_read", { p_domain_id: activeRoom.id });
        })
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: "domain_id=eq." + activeRoom.id },
        ({ new: m }) => setMessages((prev) => prev.map((x) => x.id === m.id
          ? { ...x, deleted: m.deleted, author_deleted: m.author_deleted, content: m.content, link_status: m.link_status, is_pinned: m.is_pinned, pinned_at: m.pinned_at }
          : x)))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        (payload) => {
          const isDel = payload.eventType === "DELETE";
          const row = isDel ? payload.old : payload.new;
          if (!row?.message_id) return;
          setReactions((prev) => {
            const list = (prev[row.message_id] || []).filter((r) => !(r.user_id === row.user_id && r.emoji === row.emoji));
            if (!isDel) list.push({ user_id: row.user_id, emoji: row.emoji });
            return { ...prev, [row.message_id]: list };
          });
        })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        if (!payload || payload.user_id === me.id) return;
        setTyping((t) => ({ ...t, [payload.user_id]: { name: payload.name, at: Date.now() } }));
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

  // Keep my read watermark fresh so my "seen" reaches everyone even if a realtime echo was missed:
  // re-mark whenever I focus / return to the tab with a room open. (Send + realtime-receive cover the rest.)
  useEffect(() => {
    if (!activeRoom || activeRoom.key === "ann" || activeRoom.key === "milestones") return;
    const mark = () => { if (document.visibilityState === "visible") supabase.rpc("mark_room_read", { p_domain_id: activeRoom.id }); };
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => { window.removeEventListener("focus", mark); document.removeEventListener("visibilitychange", mark); };
  }, [activeRoom]);

  // Jump to a mentioned message: once the room's messages render, scroll + briefly highlight it.
  useEffect(() => {
    if (!pendingScroll) return;
    const el = document.getElementById("msg-" + pendingScroll);
    if (!el) return; // messages not loaded yet — this re-runs when they arrive
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-amber-400", "rounded-sm");
    const t = setTimeout(() => el.classList.remove("ring-2", "ring-amber-400", "rounded-sm"), 2500);
    setPendingScroll(null);
    return () => clearTimeout(t);
  }, [messages, pendingScroll, activeRoom]);

  // Persistent mention inbox: the recent mentions (with the exact message) + realtime beep.
  async function loadMentions() {
    const { data } = await supabase.from("mentions")
      .select("id,content,message_id,domain_id,author_id,read,created_at,kind")
      .eq("mentioned_user_id", me.id)
      .order("created_at", { ascending: false }).limit(25);
    const rows = data || [];
    const ids = [...new Set(rows.map((r) => r.author_id))].filter((id) => !cache.current.has(id));
    if (ids.length) {
      const { data: profs } = await supabase.from("public_profiles").select("id,display_name,role,avatar_url").in("id", ids);
      (profs || []).forEach(remember);
    }
    setMentions(rows.map((r) => ({ ...r, authorName: cache.current.get(r.author_id)?.display_name || "Someone" })));
    setUnreadMentions(rows.filter((r) => !r.read).length);
  }

  useEffect(() => {
    loadMentions();
    const ch = supabase.channel("mentions:" + me.id)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "mentions", filter: "mentioned_user_id=eq." + me.id },
        () => { loadMentions(); beep(); })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me.id]);

  // Unread DM count for the nav badge (clears as threads are opened/marked-seen).
  async function loadDmUnread() {
    if (isAdmin) {
      const { data } = await supabase.from("dm_messages").select("student_id,sender_id").is("seen_at", null);
      setDmUnread((data || []).filter((r) => r.sender_id === r.student_id).length);
    } else {
      const { count } = await supabase.from("dm_messages").select("id", { count: "exact", head: true })
        .eq("student_id", me.id).neq("sender_id", me.id).is("seen_at", null);
      setDmUnread(count || 0);
    }
  }
  useEffect(() => {
    loadDmUnread();
    const ch = supabase.channel("dm-unread:" + me.id)
      .on("postgres_changes", { event: "*", schema: "public", table: "dm_messages" }, () => loadDmUnread())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [me.id, isAdmin]);

  async function clearMentions() {
    setUnreadMentions(0);
    setMentions((list) => list.map((m) => ({ ...m, read: true })));
    await supabase.from("mentions").update({ read: true })
      .eq("mentioned_user_id", me.id).eq("read", false);
  }

  // Click a mention → open its room and scroll to the exact message.
  function jumpToMention(mn) {
    const room = rooms.find((r) => r.id === mn.domain_id);
    if (room) setActiveRoom(room);
    if (mn.message_id) setPendingScroll(mn.message_id);
    if (!mn.read) {
      supabase.from("mentions").update({ read: true }).eq("id", mn.id);
      setMentions((list) => list.map((x) => (x.id === mn.id ? { ...x, read: true } : x)));
      setUnreadMentions((n) => Math.max(0, n - 1));
    }
  }

  // Add/remove one of my reactions on a message (optimistic; realtime reconciles for everyone else).
  async function toggleReaction(messageId, emoji) {
    const mine = (reactions[messageId] || []).some((r) => r.user_id === me.id && r.emoji === emoji);
    setReactions((prev) => {
      const list = (prev[messageId] || []).filter((r) => !(r.user_id === me.id && r.emoji === emoji));
      if (!mine) list.push({ user_id: me.id, emoji });
      return { ...prev, [messageId]: list };
    });
    if (mine) {
      await supabase.from("message_reactions").delete().eq("message_id", messageId).eq("user_id", me.id).eq("emoji", emoji);
    } else {
      await supabase.from("message_reactions").insert({ message_id: messageId, user_id: me.id, emoji });
    }
  }

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
    // Resolve @mentions picked this compose that are still present in the final text.
    const bodyLower = body.toLowerCase();
    const mentionIds = new Set();
    for (const [name, id] of selectedMentions.current.entries()) {
      if (id !== me.id && bodyLower.includes("@" + name)) mentionIds.add(id);
    }
    // "@all" — founders/admins only — fans a bell notification out to every member of this room
    // (announcements has no composer, so it's naturally excluded).
    if (isAdmin && /(?:^|\s)@all\b/i.test(body)) {
      for (const mem of members) if (mem.id !== me.id) mentionIds.add(mem.id);
    }
    const replyTarget = replyingTo; // capture before clearing state
    const { data: inserted, error } = await supabase.from("messages").insert({
      domain_id: activeRoom.id,
      user_id: me.id,
      content: body,
      link_status: isLink ? "pending" : "approved",
      reply_to: replyTarget?.id || null,
    }).select("id").single();
    if (error) { setErr(error.message); return; }
    setReplyingTo(null);
    // Posting proves I've read the room up to now — advance my "seen" watermark immediately instead of
    // relying on the realtime echo (which drops on reconnects and leaves me stuck at "seen by 0").
    supabase.rpc("mark_room_read", { p_domain_id: activeRoom.id });
    // Bell notifications: @mentions + a "reply" to the original author (skip if they were also @mentioned).
    const notif = [...mentionIds].map((uid) => ({
      message_id: inserted?.id, domain_id: activeRoom.id, author_id: me.id,
      mentioned_user_id: uid, content: body.slice(0, 200), kind: "mention",
    }));
    if (replyTarget?.authorId && replyTarget.authorId !== me.id && !mentionIds.has(replyTarget.authorId)) {
      notif.push({
        message_id: inserted?.id, domain_id: activeRoom.id, author_id: me.id,
        mentioned_user_id: replyTarget.authorId, content: body.slice(0, 200), kind: "reply",
      });
    }
    if (notif.length) await supabase.from("mentions").insert(notif);
    selectedMentions.current.clear();
    setMentionQuery(null);
  }

  // Insert an emoji at the end of the composer.
  function insertEmoji(emoji) {
    setText((t) => t + emoji);
    setComposerPicker(false);
    inputRef.current?.focus();
  }

  // Upload a file and post it as a chat message (caption = current text, else the file name).
  async function sendAttachment(file) {
    if (!file || !activeRoom || me.banned || timedOut) return;
    setErr("");
    setAttaching(true);
    try {
      const { key, name } = await uploadToR2(file, { kind: "chat" });
      const caption = text.trim();
      const { error } = await supabase.from("messages").insert({
        domain_id: activeRoom.id, user_id: me.id,
        content: caption || name, file_key: key, file_name: name,
        link_status: "approved", reply_to: replyingTo?.id || null,
      });
      if (error) { setErr(error.message); return; }
      setText(""); setReplyingTo(null);
      supabase.rpc("mark_room_read", { p_domain_id: activeRoom.id });
    } catch (e) { setErr(e.message || "Attachment upload failed."); }
    finally { setAttaching(false); }
  }

  function handleInput(e) {
    const val = e.target.value;
    setText(val);
    if (err) setErr("");
    const now = Date.now();
    if (now - typingSentAt.current > 2000 && channelRef.current) {
      typingSentAt.current = now;
      channelRef.current.send({ type: "broadcast", event: "typing", payload: { user_id: me.id, name: me.display_name } });
    }
    // Mention autocomplete: is the caret inside an "@token" (start-of-line or after whitespace)?
    const caret = e.target.selectionStart ?? val.length;
    const upto = val.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at >= 0 && (at === 0 || /\s/.test(upto[at - 1]))) {
      const q = upto.slice(at + 1);
      setMentionQuery(!q.includes("\n") && q.length <= 30 ? q : null);
    } else {
      setMentionQuery(null);
    }
  }

  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    const people = members
      .filter((mem) => mem.id !== me.id && (mem.display_name || "").toLowerCase().includes(q))
      .slice(0, 6);
    // Founders/admins get an "@all" broadcast option that notifies the whole channel.
    if (isAdmin && "all".includes(q)) {
      return [{ id: "__all__", display_name: "all", isBroadcast: true }, ...people].slice(0, 7);
    }
    return people;
  }, [mentionQuery, members, me.id, isAdmin]);

  // Insert the picked member's "@Name " into the composer at the active token.
  function pickMention(mem) {
    const val = text;
    const caret = inputRef.current?.selectionStart ?? val.length;
    const upto = val.slice(0, caret);
    const at = upto.lastIndexOf("@");
    if (at < 0) return;
    const before = val.slice(0, at);
    const after = val.slice(caret);
    const token = `@${mem.display_name} `;
    setText(before + token + after);
    // "@all" is detected straight from the text at send-time — don't register it as a picked user.
    if (!mem.isBroadcast) selectedMentions.current.set((mem.display_name || "").toLowerCase(), mem.id);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const pos = (before + token).length;
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(pos, pos);
    });
  }

  async function softDelete(id) {
    await supabase.from("messages").update({ deleted: true }).eq("id", id);
  }

  // Student "delete for me": hide only from my view (others still see it).
  async function deleteForMe(id) {
    setHidden((s) => new Set(s).add(id));
    await supabase.from("message_hides").insert({ user_id: me.id, message_id: id });
  }
  // Student "delete for everyone": hidden from other students; admins/founders keep a copy.
  async function deleteForEveryone(id) {
    setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, author_deleted: true } : x)));
    await supabase.rpc("message_delete_for_everyone", { p_message_id: id });
  }
  // "Clear chat" for me only (group rooms; never Announcements): hide everything up to now.
  async function clearChatForMe() {
    if (!activeRoom || activeRoom.key === "ann") return;
    setClearedAt(new Date().toISOString());
    await supabase.rpc("clear_room", { p_domain_id: activeRoom.id });
  }
  // "Message info": who in this room has seen my message vs hasn't (based on their last-read time).
  async function openMessageInfo(m) {
    const { data: reads } = await supabase.from("room_reads").select("user_id,last_read_at").eq("domain_id", activeRoom.id);
    const readMap = new Map((reads || []).map((r) => [r.user_id, r.last_read_at]));
    const created = new Date(m.created_at).getTime();
    const seen = [], unseen = [];
    members.filter((mem) => mem.id !== me.id).forEach((mem) => {
      const lr = readMap.get(mem.id);
      (lr && new Date(lr).getTime() >= created ? seen : unseen).push(mem);
    });
    setMsgInfo({ m, seen, unseen });
  }

  async function report(m) {
    const reason = window.prompt("Report this message to admins. Reason (optional):");
    if (reason === null) return; // cancelled
    const { error } = await supabase.from("message_reports").insert({ message_id: m.id, reporter_id: me.id, reason: reason.trim() || null });
    setErr(error ? error.message : "");
    if (!error) window.alert("Reported. Admins will review it.");
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
    const clearedTs = clearedAt ? new Date(clearedAt).getTime() : 0;
    return messages.filter((m) => {
      if (m.deleted) return false;                     // admin moderation delete — gone for all
      if (m.author_deleted && !isAdmin) return false;  // author "delete for everyone" — students don't see; staff keep it
      if (hidden.has(m.id)) return false;              // "delete for me"
      if (clearedTs && new Date(m.created_at).getTime() <= clearedTs) return false; // "clear chat for me"
      if (m.link_status === "pending") {
        if (!isAdmin && m.user_id !== me.id) return false;
      }
      if (m.link_status === "rejected" && !isAdmin) return false;
      return true;
    });
  }, [messages, isAdmin, me.id, hidden, clearedAt]);

  const pinnedMessages = useMemo(() => {
    return visibleMessages.filter((m) => m.is_pinned && !m.deleted);
  }, [visibleMessages]);

  const memberNames = useMemo(
    () => members.map((m) => m.display_name).filter(Boolean),
    [members]
  );

  // Members sidebar: Admins + Members, each split into Online / Offline (realtime presence-driven).
  const memberGroups = useMemo(() => {
    const split = (list) => ({
      online: list.filter((m) => online.has(m.id)),
      offline: list.filter((m) => !online.has(m.id)),
    });
    return {
      admins: split(members.filter((m) => m.role === "admin")),
      others: split(members.filter((m) => m.role !== "admin")),
    };
  }, [members, online]);

  // Desktop 3-column widths — collapse either sidebar to a thin rail. All four literals are kept
  // whole so Tailwind's JIT emits them (it can't see dynamically concatenated arbitrary values).
  const gridCols = leftOpen
    ? (rightOpen ? "md:grid-cols-[220px_minmax(0,1fr)_240px]" : "md:grid-cols-[220px_minmax(0,1fr)_44px]")
    : (rightOpen ? "md:grid-cols-[44px_minmax(0,1fr)_240px]" : "md:grid-cols-[44px_minmax(0,1fr)_44px]");

  // Track desktop breakpoint so pixel widths only apply on desktop (mobile stacks to one column).
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setIsDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Load persisted panel sizes / collapse state (per browser).
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem("zdr_chat_panels") || "{}");
      if (typeof s.leftW === "number") setLeftW(s.leftW);
      if (typeof s.rightW === "number") setRightW(s.rightW);
      if (typeof s.leftOpen === "boolean") setLeftOpen(s.leftOpen);
      if (typeof s.rightOpen === "boolean") setRightOpen(s.rightOpen);
    } catch { /* ignore */ }
    setMounted(true);
  }, []);
  useEffect(() => {
    try { localStorage.setItem("zdr_chat_panels", JSON.stringify({ leftW, rightW, leftOpen, rightOpen })); } catch { /* ignore */ }
  }, [leftW, rightW, leftOpen, rightOpen]);

  // Drag-to-resize; dragging narrower than the minimum snaps the panel to its collapsed rail.
  useEffect(() => {
    if (!dragging) return;
    function onMove(e) {
      if (dragging === "left") {
        const w = Math.min(420, e.clientX);
        if (w < 120) setLeftOpen(false);
        else { setLeftOpen(true); setLeftW(Math.max(160, w)); }
      } else {
        const w = Math.min(460, window.innerWidth - e.clientX);
        if (w < 130) setRightOpen(false);
        else { setRightOpen(true); setRightW(Math.max(180, w)); }
      }
    }
    function onUp() { setDragging(null); }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.userSelect = "none";
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
  }, [dragging]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <header className="sticky top-0 z-20 bg-black/60 backdrop-blur-xl border-b border-blood/25 shadow-[0_1px_0_0_rgba(225,6,0,0.25),0_8px_24px_-12px_rgba(225,6,0,0.4)]">
        <div className="w-full flex items-center justify-between px-4 sm:px-6 py-3 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/logo.svg" alt="" width={32} height={32} className="h-8 w-8 animate-glow-pulse" />
            <span className="font-mono text-xs md:text-sm tracking-widest truncate">
              <span className="grad-text font-bold">ZERODAY</span> <span className="neon-red">REAPERS</span>
              <span className="text-neutral-600 hidden sm:inline"> · PORTAL</span>
            </span>
          </div>
          <PortalMenu
            me={me}
            unreadMentions={unreadMentions}
            mentions={mentions}
            onJumpToMention={jumpToMention}
            onClearMentions={clearMentions}
            dmUnread={dmUnread}
            onSignOut={onSignOut}
            onOpenDM={onOpenDM}
            onOpenDashboard={onOpenDashboard}
            onOpenTasks={onOpenTasks}
            onOpenDocs={onOpenDocs}
            onOpenCalendar={onOpenCalendar}
            onOpenActivity={onOpenActivity}
            onOpenFeedback={onOpenFeedback}
            onOpenProfile={onOpenProfile}
            onOpenAdmin={onOpenAdmin}
          />
        </div>
      </header>

      <div className={`flex-1 min-h-0 w-full grid grid-cols-1 ${gridCols} gap-0 min-w-0 overflow-hidden`}
        style={mounted && isDesktop ? { gridTemplateColumns: `${leftOpen ? leftW : 44}px minmax(0,1fr) ${rightOpen ? rightW : 44}px` } : undefined}>
        {/* Left: channels / groups nav (desktop). On mobile these collapse to the horizontal tabs below. */}
        <aside className="hidden md:flex flex-col border-r border-white/5 bg-black/30 backdrop-blur-xl overflow-y-auto min-h-0">
          {leftOpen ? (
            <>
              <div className="px-4 py-3 flex items-center justify-between border-b border-white/5">
                <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500">Channels</span>
                <button onClick={() => setLeftOpen(false)} title="Collapse channels" aria-label="Collapse channels"
                  className="font-mono text-sm text-neutral-500 hover:text-blood leading-none px-1">«</button>
              </div>
              <nav className="p-2 space-y-1">
                {rooms.map((r) => (
                  <button key={r.id} onClick={() => setActiveRoom(r)}
                    className={`w-full text-left px-3 py-2 rounded-lg font-mono text-xs tracking-wide transition truncate ${activeRoom?.id === r.id ? "btn-neon" : "text-neutral-400 hover:text-white hover:bg-white/5 border border-transparent hover:border-neon-cyan/30"}`}>
                    {r.name}
                  </button>
                ))}
              </nav>
            </>
          ) : (
            <button onClick={() => setLeftOpen(true)} title="Show channels" aria-label="Show channels"
              className="p-3 font-mono text-sm text-neutral-500 hover:text-blood">»</button>
          )}
        </aside>

        <div className="relative flex flex-col min-h-0 overflow-hidden border-r border-white/5 min-w-0">
          {isDesktop && (
            <>
              <div onMouseDown={() => setDragging("left")} title="Drag to resize" role="separator" aria-label="Resize channels panel"
                className="hidden md:block absolute left-0 top-0 bottom-0 w-1.5 z-10 cursor-col-resize hover:bg-neon-cyan/40 transition-colors" />
              <div onMouseDown={() => setDragging("right")} title="Drag to resize" role="separator" aria-label="Resize members panel"
                className="hidden md:block absolute right-0 top-0 bottom-0 w-1.5 z-10 cursor-col-resize hover:bg-neon-cyan/40 transition-colors" />
            </>
          )}
          <div className="md:hidden flex gap-2 p-3 border-b border-white/5 bg-black/20 backdrop-blur-md font-mono text-xs uppercase tracking-widest overflow-x-auto">
            {rooms.map((r) => (
              <button key={r.id} onClick={() => setActiveRoom(r)}
                className={`px-3.5 py-1.5 rounded-lg transition shrink-0 whitespace-nowrap ${activeRoom?.id === r.id ? "btn-neon" : "text-neutral-400 hover:text-white border border-white/5 hover:border-neon-cyan/40"}`}>
                {r.name}
              </button>
            ))}
          </div>

          {activeRoom?.key === "ann" ? (
            <AnnouncementsChannel me={me} />
          ) : activeRoom?.key === "milestones" ? (
            <MilestonesChannel me={me} />
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
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-white/5 shrink-0">
                <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 truncate">{activeRoom?.name}</span>
                <button onClick={clearChatForMe} title="Clear this chat for you only — others are unaffected"
                  className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 hover:text-blood transition shrink-0">🧹 Clear chat</button>
              </div>
              <div className="flex-1 min-h-0 p-4 overflow-y-auto space-y-4">
                {loading && <p className="font-mono text-xs text-neutral-600">Decryption in progress...</p>}
                {!loading && !visibleMessages.length && <p className="font-mono text-xs text-neutral-600">No signals intercepted yet.</p>}
                {visibleMessages.map((m) => (
                  <Message key={m.id} m={m} isAdmin={isAdmin} myId={me.id} memberNames={memberNames} myName={me.display_name}
                  isMine={m.user_id === me.id}
                  dept={m.profiles?.role !== "admin" ? deptById[m.profiles?.domain_id] : null}
                  onDeleteForMe={deleteForMe} onDeleteForEveryone={deleteForEveryone} onMessageInfo={openMessageInfo}
                  onDelete={softDelete} onTogglePin={togglePin} onApproveLink={approveLink} onRejectLink={rejectLink} onReport={report}
                  reactions={reactions[m.id]} onToggleReaction={toggleReaction}
                  onReply={() => setReplyingTo({ id: m.id, authorId: m.user_id, authorName: m.profiles?.display_name, content: m.content })}
                  pickerOpen={picker === m.id} onOpenPicker={() => setPicker(m.id)} onClosePicker={() => setPicker(null)}
                  parent={m.reply_to ? messages.find((x) => x.id === m.reply_to) : null}
                  onJumpToParent={() => m.reply_to && setPendingScroll(m.reply_to)} />
                ))}
                <div ref={bottomRef} />
              </div>
              <div className="p-3 border-t border-white/5 bg-black/40 backdrop-blur-xl">
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
                {mentionSuggestions.length > 0 && (
                  <div className="mb-2 border border-blood/30 bg-ink-950 rounded-sm max-h-44 overflow-y-auto">
                    <div className="px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-neutral-500 border-b border-blood/10">Mention someone</div>
                    {mentionSuggestions.map((mem) => (
                      <button key={mem.id} type="button" onClick={() => pickMention(mem)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-blood/20 transition">
                        {mem.isBroadcast ? (
                          <>
                            <span className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center text-base bg-blood/20">📢</span>
                            <span className="font-mono text-xs text-blood truncate">
                              @all <span className="text-neutral-500">· notify everyone in this channel</span>
                            </span>
                          </>
                        ) : (
                          <>
                            <MiniAvatar p={mem} />
                            <span className="font-mono text-xs text-neutral-200 truncate">
                              {mem.display_name}{mem.role === "admin" ? " · admin" : ""}
                            </span>
                          </>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {me.banned || timedOut ? (
                  <div className="font-mono text-xs text-blood py-2 text-center border border-blood/30 bg-blood/5">
                    {me.banned ? "TERMINAL ACCESS REVOKED." : `TEMPORARILY MUTED UNTIL ${new Date(me.timeout_until).toLocaleTimeString()}`}
                  </div>
                ) : (
                  <>
                    {replyingTo && (
                      <ReplyBanner authorName={replyingTo.authorName} content={replyingTo.content} onCancel={() => setReplyingTo(null)} />
                    )}
                    {composerPicker && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setComposerPicker(false)} />
                        <div className="relative z-50 mb-2">
                          <EmojiPicker theme="dark" emojiStyle="native" lazyLoadEmojis width="100%" height={360}
                            previewConfig={{ showPreview: false }} onEmojiClick={(e) => insertEmoji(e.emoji)} />
                        </div>
                      </>
                    )}
                    <form onSubmit={send} className="flex gap-2 items-center">
                      <button type="button" onClick={() => setComposerPicker((o) => !o)} title="Emoji"
                        className="shrink-0 text-lg px-1.5 text-neutral-400 hover:text-amber-400 transition">😊</button>
                      <label title="Attach a file (PDF, image, DOCX, TXT)"
                        className={`shrink-0 cursor-pointer text-lg px-1 text-neutral-400 hover:text-blood transition ${attaching ? "opacity-50 pointer-events-none" : ""}`}>
                        {attaching ? "⏳" : "📎"}
                        <input type="file" accept=".pdf,.docx,.txt,image/*" className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; sendAttachment(f); }} />
                      </label>
                      <input ref={inputRef} type="text" value={text} onChange={handleInput} autoComplete="off" placeholder={`Transmit to #${activeRoom?.name || "room"}...`}
                        className="flex-1 min-w-0 bg-neutral-950 border border-neutral-800 rounded-sm px-3 py-2 text-sm text-white placeholder-neutral-600 focus:outline-none focus:border-blood font-mono" />
                      <button type="submit" className="shrink-0 font-mono text-xs uppercase tracking-widest btn-neon font-bold px-4 py-2 rounded-sm hover:bg-blood/90 transition">
                        Send
                      </button>
                    </form>
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <aside className={`hidden md:block border-l border-white/5 bg-black/30 backdrop-blur-xl overflow-y-auto min-h-0 ${rightOpen ? "p-4 space-y-6" : "p-2"}`}>
          {rightOpen ? (
            <>
              <div className="flex justify-end -mb-3">
                <button onClick={() => setRightOpen(false)} title="Collapse members" aria-label="Collapse members"
                  className="font-mono text-sm text-neutral-500 hover:text-blood leading-none px-1">»</button>
              </div>
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-blood font-semibold mb-3 flex items-center gap-1.5">
              <span>Admins</span>
              <span className="text-[10px] bg-blood/20 text-blood px-1.5 py-0.5 rounded-sm">
                {memberGroups.admins.online.length + memberGroups.admins.offline.length}
              </span>
            </div>
            <OnlineOffline groups={memberGroups.admins} rowProps={{ isAdmin, online, roomCounts, deptById }} />
          </div>

          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-neutral-500 mb-3 flex items-center gap-1.5">
              <span>{activeRoom?.key === "alumni" ? "Alumni" : "Members"}</span>
              <span className="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded-sm">
                {memberGroups.others.online.length + memberGroups.others.offline.length}
              </span>
            </div>
            <OnlineOffline groups={memberGroups.others} rowProps={{ isAdmin, online, roomCounts, deptById }} />
          </div>
            </>
          ) : (
            <button onClick={() => setRightOpen(true)} title="Show members" aria-label="Show members"
              className="font-mono text-sm text-neutral-500 hover:text-blood">«</button>
          )}
        </aside>
      </div>

      {msgInfo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => setMsgInfo(null)}>
          <div className="glass w-full max-w-sm p-5 font-mono" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-mono text-sm uppercase tracking-widest text-white">Message info</h3>
              <button onClick={() => setMsgInfo(null)} className="text-neutral-500 hover:text-blood text-xs">✕</button>
            </div>
            <p className="text-xs text-neutral-400 border-l-2 border-blood/40 pl-2 mb-4 line-clamp-3 whitespace-pre-wrap">{msgInfo.m.content}</p>
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-widest text-[#34d399] mb-1.5">✓✓ Seen by {msgInfo.seen.length}</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {msgInfo.seen.length === 0
                  ? <p className="text-[11px] text-neutral-600">No one yet.</p>
                  : msgInfo.seen.map((mem) => (
                    <div key={mem.id} className="flex items-center gap-2"><MiniAvatar p={mem} /><span className="text-xs text-neutral-300 truncate">{mem.display_name}</span></div>
                  ))}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-neutral-500 mb-1.5">Not seen ({msgInfo.unseen.length})</div>
              <div className="max-h-40 overflow-y-auto space-y-1">
                {msgInfo.unseen.length === 0
                  ? <p className="text-[11px] text-neutral-600">Everyone has seen it.</p>
                  : msgInfo.unseen.map((mem) => (
                    <div key={mem.id} className="flex items-center gap-2 opacity-70"><MiniAvatar p={mem} /><span className="text-xs text-neutral-400 truncate">{mem.display_name}</span></div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Message({ m, isAdmin, myId, memberNames, myName, isMine, dept, onDeleteForMe, onDeleteForEveryone, onMessageInfo, onDelete, onTogglePin, onApproveLink, onRejectLink, onReport,
  reactions, onToggleReaction, onReply, pickerOpen, onOpenPicker, onClosePicker, parent, onJumpToParent }) {
  const p = m.profiles || {};
  const link = firstLink(m.content);
  return (
    <div id={"msg-" + m.id} className={`group flex items-start gap-3 transition-shadow ${m.author_deleted ? "opacity-60" : ""}`}>
      <MiniAvatar p={p} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          {dept && <span className="font-mono text-[9px] font-bold tracking-widest px-1 py-0.5 rounded-sm shrink-0" style={{ color: dept.color, backgroundColor: dept.color + "1a" }} title="Department">{dept.code}</span>}
          <span className="font-mono text-sm text-white">{p.display_name || "Unknown"}</span>
          {p.country && <Flag code={p.country} className="text-sm" />}
          {p.role === "admin" && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm btn-neon">Admin</span>
          )}
          {p.is_alumni && p.role !== "admin" && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-[#38bdf8] text-ink-950">Alumni 🎓</span>
          )}
          {m.is_pinned && !m.deleted && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-amber-500 text-ink-950 font-bold shadow-sm">
              📌 Pinned
            </span>
          )}
          {m.author_deleted && (
            <span className="font-mono text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded-sm bg-neutral-700 text-neutral-300" title="Author deleted this for everyone — visible to staff only">🗑 deleted by author</span>
          )}
          <span className="font-mono text-[10px] text-neutral-600">{fmtTime(m.created_at)}</span>
          {isAdmin && !m.deleted && (
            <>
              <button onClick={() => onTogglePin(m)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-amber-400 transition">
                {m.is_pinned ? "unpin" : "pin"}
              </button>
              <button onClick={() => onDelete(m.id)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-blood transition">
                delete
              </button>
            </>
          )}
          {!isAdmin && !m.deleted && m.user_id !== myId && (
            <button onClick={() => onReport(m)} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-blood transition">
              report
            </button>
          )}
          {isMine && !m.deleted && (
            <>
              <button onClick={() => onMessageInfo(m)} title="Who has seen this message" className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-neon-cyan transition">info</button>
              {!m.author_deleted && (
                <button onClick={() => { if (window.confirm("Delete this message for everyone? Other students won't see it (admins keep a copy).")) onDeleteForEveryone(m.id); }} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-blood transition">delete for everyone</button>
              )}
              <button onClick={() => onDeleteForMe(m.id)} title="Hide only from your view" className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-blood transition">delete for me</button>
            </>
          )}
          {!m.deleted && (
            <>
              <button onClick={onReply} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-blood transition">reply</button>
              <button onClick={onOpenPicker} className="opacity-100 md:opacity-0 md:group-hover:opacity-100 text-[10px] font-mono text-neutral-500 hover:text-amber-400 transition">react</button>
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
                <button onClick={() => onRejectLink(m.id)} className="btn-neon px-2.5 py-1 rounded-sm font-bold uppercase text-[10px] tracking-wider hover:bg-blood-glow transition">Reject</button>
              </div>
            )}
          </div>
        )}
        {m.reply_to && !m.deleted && (
          <ReplyQuote
            authorName={parent?.profiles?.display_name}
            content={parent ? parent.content : "original message"}
            onJump={onJumpToParent}
          />
        )}
        {m.file_key && !m.deleted && (
          <button onClick={() => downloadFromR2(m.file_key)}
            className="my-1 inline-flex items-center gap-2 rounded-sm border border-blood/30 bg-ink-900/60 px-3 py-2 text-left hover:border-blood transition max-w-full">
            <span className="text-lg shrink-0">{fileIcon(m.file_name)}</span>
            <span className="min-w-0">
              <span className="block text-xs text-neutral-200 truncate">{m.file_name || "attachment"}</span>
              <span className="block text-[10px] text-neutral-500">Click to download ↗</span>
            </span>
          </button>
        )}
        {!(m.file_key && m.content === m.file_name) && (
          <p className="text-sm text-neutral-300 break-words whitespace-pre-wrap">{renderMessageContent(m.content, { memberNames, myName })}</p>
        )}
        {!m.deleted && m.link_status === "approved" && link && <LinkPreview url={link} />}
        {!m.deleted && (
          <ReactionRow messageId={m.id} reactions={reactions} meId={myId} onToggle={onToggleReaction} pickerOpen={pickerOpen} onClosePicker={onClosePicker} />
        )}
      </div>
    </div>
  );
}

// Small clickable LinkedIn badge shown next to a member (profile or company page).
function LinkedInIcon({ url }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="LinkedIn" onClick={(e) => e.stopPropagation()}
      className="shrink-0 text-[10px] font-bold leading-none text-[#0a66c2] hover:text-[#378fe9] border border-[#0a66c2]/50 rounded-sm px-1 py-0.5">
      in
    </a>
  );
}

// Small clickable GitHub badge shown next to a member (profile or org).
function GitHubIcon({ url }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="GitHub" onClick={(e) => e.stopPropagation()}
      className="shrink-0 text-[10px] font-bold leading-none text-neutral-300 hover:text-white border border-neutral-600 rounded-sm px-1 py-0.5">
      gh
    </a>
  );
}

// One member row in the sidebar — admin rows are red + no dept tag; member rows carry dept + alumni.
function MemberRow({ mem, isAdmin, online, roomCounts, deptById }) {
  const isAdminRow = mem.role === "admin";
  const dept = !isAdminRow ? deptById[mem.domain_id] : null;
  return (
    <div className="flex items-center gap-2">
      <MiniAvatar p={mem} />
      <span className={`font-mono text-xs truncate ${isAdminRow ? "text-blood font-medium" : "text-neutral-300"}`}>
        {mem.display_name} {mem.country && <Flag code={mem.country} />} {!isAdminRow && mem.is_alumni ? "🎓" : ""}
        {dept && (
          <span className="ml-1 text-[9px] font-bold tracking-widest" style={{ color: dept.color }} title="Department">{dept.code}</span>
        )}
      </span>
      {mem.linkedin_url && <LinkedInIcon url={mem.linkedin_url} />}
      {mem.github_url && <GitHubIcon url={mem.github_url} />}
      <span className="ml-auto flex items-center gap-1.5">
        {isAdmin && <span className="font-mono text-[10px] text-neutral-500" title="messages in this room">{roomCounts[mem.id] || 0}</span>}
        {online.has(mem.id) && <span className="w-2 h-2 rounded-full bg-[#34d399]" title="online" />}
      </span>
    </div>
  );
}

// Online / Offline sub-groups for one section (Admins or Members), each with a live count.
function OnlineOffline({ groups, rowProps }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-[#34d399] mb-1.5 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#34d399]" /> Online <span className="text-neutral-600">— {groups.online.length}</span>
        </div>
        <div className="space-y-2">
          {groups.online.map((mem) => <MemberRow key={mem.id} mem={mem} {...rowProps} />)}
        </div>
      </div>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-1.5 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-600" /> Offline <span className="text-neutral-600">— {groups.offline.length}</span>
        </div>
        <div className="space-y-2 opacity-70">
          {groups.offline.map((mem) => <MemberRow key={mem.id} mem={mem} {...rowProps} />)}
        </div>
      </div>
    </div>
  );
}

function MiniAvatar({ p = {} }) {
  // Status ring: admins red, alumni cyan — a subtle "border" cue in chat.
  const ring = p.role === "admin" ? " ring-2 ring-blood" : p.is_alumni ? " ring-2 ring-[#38bdf8]" : "";
  if (p.avatar_url) {
    return <img src={p.avatar_url} alt="" className={"h-8 w-8 rounded-full object-cover shrink-0" + ring} />;
  }
  return (
    <div className={"h-8 w-8 rounded-full shrink-0 flex items-center justify-center font-mono text-xs text-white" + ring}
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
