"use client";

import { useEffect, useRef, useState } from "react";

// Consolidated portal navigation: the mentions bell + a single dropdown menu, so the header
// stays clean no matter how many destinations exist. Self-contained open/close state.
export default function PortalMenu({
  me, unreadMentions = 0, onClearMentions, onSignOut,
  onOpenDM, onOpenDashboard, onOpenTasks, onOpenDocs,
  onOpenCalendar, onOpenActivity, onOpenFeedback, onOpenProfile, onOpenAdmin,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onEsc(e) { if (e.key === "Escape") setOpen(false); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onEsc); };
  }, []);

  const isAdmin = me.role === "admin";
  const isStudent = !isAdmin && !me.is_alumni;
  const go = (fn) => () => { setOpen(false); fn?.(); };

  // [label, handler, visible]
  const items = [
    [isAdmin ? "DMs" : "Message Admin", onOpenDM, true],
    ["Dashboard", onOpenDashboard, isStudent],
    ["Tasks", onOpenTasks, isStudent],
    ["Documents", onOpenDocs, isStudent],
    ["Calendar", onOpenCalendar, true],
    ["Activity", onOpenActivity, !isAdmin],
    ["Feedback", onOpenFeedback, !isAdmin],
    ["Profile", onOpenProfile, true],
    ["Admin panel", onOpenAdmin, isAdmin],
  ].filter(([, , vis]) => vis);

  const item = "w-full text-left px-4 py-2.5 text-xs font-mono uppercase tracking-widest text-neutral-300 hover:bg-blood hover:text-ink-950 transition";

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={onClearMentions}
        title={unreadMentions ? `${unreadMentions} new mention(s) — click to clear` : "No new mentions"}
        className="relative font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition"
      >
        🔔
        {unreadMentions > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-blood text-ink-950 text-[10px] font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
            {unreadMentions > 9 ? "9+" : unreadMentions}
          </span>
        )}
      </button>

      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={open}
          className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest border border-blood text-blood px-3 py-2 rounded-sm hover:bg-blood hover:text-ink-950 transition"
        >
          Menu
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
        </button>

        {open && (
          <div role="menu" className="absolute right-0 mt-2 w-52 bg-black border border-blood/30 rounded-sm shadow-2xl shadow-black/50 z-30 py-1 overflow-hidden">
            {items.map(([label, fn]) => (
              <button key={label} role="menuitem" onClick={go(fn)} className={item}>{label}</button>
            ))}
            <div className="my-1 border-t border-neutral-800" />
            <button role="menuitem" onClick={go(onSignOut)} className={`${item} hover:bg-neutral-800 hover:text-blood`}>Log out</button>
          </div>
        )}
      </div>
    </div>
  );
}
