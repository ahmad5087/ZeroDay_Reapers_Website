"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Full-width red announcement strip at the top of the portal (styled like the website's launch banner).
// Shows the newest announcement's title, links to the Announcements room, and is dismissible per-id
// (a newer announcement re-shows it). Dismissal is remembered in localStorage.
const SEEN_KEY = "zdr_ann_banner_dismissed";

export default function PortalAnnouncementBanner({ onOpen }) {
  const [ann, setAnn] = useState(null);

  useEffect(() => {
    let cancelled = false;
    supabase.from("announcements").select("id,title").order("id", { ascending: false }).limit(1).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        let dismissed = 0;
        try { dismissed = Number(localStorage.getItem(SEEN_KEY) || 0); } catch { /* ignore */ }
        if (data.id > dismissed) setAnn(data);
      });
    // A new announcement always re-shows the banner (it's newer than any dismissed id).
    const ch = supabase.channel("ann-banner")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" },
        ({ new: a }) => setAnn(a))
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  if (!ann) return null;

  function dismiss(e) {
    e?.stopPropagation();
    try { localStorage.setItem(SEEN_KEY, String(ann.id)); } catch { /* ignore */ }
    setAnn(null);
  }

  return (
    <div className="w-full bg-blood text-ink-950 border-b border-black/25 shrink-0">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2 flex items-center justify-center gap-3">
        <button onClick={() => onOpen?.()} title="Open announcements"
          className="min-w-0 flex items-center gap-2 font-mono text-[11px] sm:text-xs uppercase tracking-widest font-bold hover:opacity-90 transition">
          <span className="shrink-0">📢</span>
          <span className="truncate">{ann.title}</span>
          <span className="shrink-0">→</span>
        </button>
        <button onClick={dismiss} aria-label="Dismiss announcement" className="shrink-0 text-ink-950/60 hover:text-ink-950 font-mono text-xs leading-none">✕</button>
      </div>
    </div>
  );
}
