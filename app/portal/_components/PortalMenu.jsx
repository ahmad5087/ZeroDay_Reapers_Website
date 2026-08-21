"use client";

import { useEffect, useRef, useState } from "react";

// Consolidated portal navigation: the mentions bell + a single dropdown menu, so the header
// stays clean no matter how many destinations exist. Self-contained open/close state.
export default function PortalMenu({
  me, unreadMentions = 0, mentions = [], onJumpToMention, onClearMentions, onSignOut, dmUnread = 0,
  onOpenDM, onOpenDashboard, onOpenTasks, onOpenDocs,
  onOpenCalendar, onOpenActivity, onOpenMentor, onOpenNotifications, onOpenSearch, onOpenFeedback, onOpenPayment, onOpenResources, onOpenOfficeHours, onOpenOpportunities, onOpenProfile, onOpenAdmin,
}) {
  const [open, setOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const ref = useRef(null);
  const bellRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    }
    function onEsc(e) { if (e.key === "Escape") { setOpen(false); setBellOpen(false); } }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, []);

  const isAdmin = me.role === "admin";
  const isAlumni = !isAdmin && me.is_alumni;
  const isStudent = !isAdmin && !me.is_alumni;
  const go = (fn) => () => { setOpen(false); fn?.(); };

  // [label, handler, visible] — alumni keep Dashboard (badges) + Documents, lose Tasks + Calendar.
  const items = [
    [isAdmin ? "DMs" : "Message Admin", onOpenDM, true],
    ["Search", onOpenSearch, true],
    ["Dashboard", onOpenDashboard, !isAdmin],
    ["Tasks", onOpenTasks, isStudent],
    ["Documents", onOpenDocs, !isAdmin],
    ["Calendar", onOpenCalendar, !isAlumni],
    ["Activity", onOpenActivity, !isAdmin],
    ["Notifications", onOpenNotifications, !isAdmin],
    ["Mentor", onOpenMentor, isStudent],
    ["Payment", onOpenPayment, isStudent],
    ["Feedback", onOpenFeedback, !isAdmin],
    ["Resources", onOpenResources, !isAdmin && !!onOpenResources],
    ["Office Hours", onOpenOfficeHours, isStudent && !!onOpenOfficeHours],
    ["Opportunities", onOpenOpportunities, !isAdmin && !!onOpenOpportunities],
    ["Profile", onOpenProfile, true],
    ["Admin panel", onOpenAdmin, isAdmin],
  ].filter(([, , vis]) => vis);

  const item = "w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-300 hover:bg-blood/90 hover:text-white transition";

  return (
    <div className="flex items-center gap-2">
      <div className="relative" ref={bellRef}>
        <button
          onClick={() => setBellOpen((o) => !o)}
          title={unreadMentions ? `${unreadMentions} new mention(s)` : "Mentions"}
          className="relative font-mono text-xs uppercase tracking-widest border border-white/10 bg-white/5 text-neutral-300 px-3 py-2 rounded-lg hover:border-neon-cyan/50 hover:text-white transition"
        >
          🔔
          {unreadMentions > 0 && (
            <span className="absolute -top-1.5 -right-1.5 btn-neon text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
              {unreadMentions > 9 ? "9+" : unreadMentions}
            </span>
          )}
        </button>

        {bellOpen && (
          <div className="fixed left-2 right-2 top-16 md:absolute md:left-auto md:right-0 md:top-auto md:mt-2 md:w-80 md:max-w-[90vw] glass-strong glass-red rounded-xl shadow-2xl shadow-black/50 z-40 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
              <span className="font-mono text-[11px] uppercase tracking-widest text-neutral-400">Mentions</span>
              {mentions.some((m) => !m.read) && (
                <button onClick={() => onClearMentions?.()} className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 hover:text-blood">Mark all read</button>
              )}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {mentions.length === 0 ? (
                <p className="px-3 py-4 font-mono text-xs text-neutral-600">No mentions yet.</p>
              ) : mentions.map((mn) => (
                <button
                  key={mn.id}
                  onClick={() => { onJumpToMention?.(mn); setBellOpen(false); }}
                  className={`w-full text-left px-3 py-2.5 border-b border-neutral-900 hover:bg-white/5 transition ${mn.read ? "" : "bg-blood/5"}`}
                >
                  <div className="flex items-center gap-2">
                    {!mn.read && <span className="w-1.5 h-1.5 rounded-full bg-blood shrink-0" />}
                    <span className="font-mono text-[11px] text-white truncate">{mn.authorName || "Someone"}</span>
                    <span className="font-mono text-[9px] uppercase tracking-widest text-blood/80 shrink-0">{mn.kind === "reply" ? "↩ replied" : "@ mention"}</span>
                    <span className="font-mono text-[10px] text-neutral-600 ml-auto shrink-0">{fmtWhen(mn.created_at)}</span>
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-400 break-words line-clamp-2">{mn.content || (mn.kind === "reply" ? "replied to you" : "mentioned you")}</p>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="btn-neon relative flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest px-4 py-2"
        >
          Menu
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
          {dmUnread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 btn-neon text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center" title={`${dmUnread} unread message(s)`}>
              {dmUnread > 9 ? "9+" : dmUnread}
            </span>
          )}
        </button>

        {open && (
          <div role="menu" className="absolute right-0 mt-2 w-52 glass-strong glass-red rounded-xl shadow-2xl shadow-black/50 z-30 py-1 overflow-hidden">
            {items.map(([label, fn]) => (
              <button key={label} role="menuitem" onClick={go(fn)} className={item + " flex items-center justify-between gap-2"}>
                <span>{label}</span>
                {fn === onOpenDM && dmUnread > 0 && (
                  <span className="btn-neon text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{dmUnread > 9 ? "9+" : dmUnread}</span>
                )}
              </button>
            ))}
            <div className="my-1 border-t border-neutral-800" />
            <button role="menuitem" onClick={go(onSignOut)} className={`${item} hover:bg-neutral-800 hover:text-blood`}>Log out</button>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtWhen(ts) {
  try {
    const d = new Date(ts);
    const sameDay = d.toDateString() === new Date().toDateString();
    return sameDay
      ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch { return ""; }
}
