"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { downloadFromR2 } from "@/lib/r2client";
import { renderMessageContent } from "./LinkPreview";

// One-time "new announcement" modal on login. Dismissal is remembered two ways so it never re-nags:
//   1) localStorage — instant, survives hard refresh, works even before the DB migrations are live.
//   2) profiles.last_seen_announcement_id via the mark_announcements_seen RPC (migration 049) — the
//      cross-device "once per account" layer. Best-effort; the localStorage guard covers the rest.
// Shows only the single newest announcement whose id is greater than both watermarks.
const SEEN_KEY = "zdr_ann_seen_id";

function readLocalSeen() {
  try { return Number(localStorage.getItem(SEEN_KEY) || 0) || 0; } catch { return 0; }
}

export default function AnnouncementPopup({ me, setMe }) {
  const [ann, setAnn] = useState(null);

  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    (async () => {
      // select("*") so this works even before the attachment columns (migration 048) exist.
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const seen = Math.max(readLocalSeen(), me.last_seen_announcement_id || 0);
      if (data.id > seen) setAnn(data);
    })();
    return () => { cancelled = true; };
  }, [me?.id]);

  if (!ann) return null;

  function dismiss() {
    const id = ann.id;
    setAnn(null);
    // Primary guard: survives hard refresh with no DB dependency.
    try { localStorage.setItem(SEEN_KEY, String(id)); } catch { /* ignore */ }
    // Cross-device layer (no-op until migration 049 is live); harmless if the RPC is missing.
    supabase.rpc("mark_announcements_seen", { p_id: id }).then(() => {}, () => {});
    setMe?.((m) => ({ ...m, last_seen_announcement_id: Math.max(m?.last_seen_announcement_id || 0, id) }));
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={dismiss}>
      <div className="w-full max-w-lg border border-blood/40 bg-ink-950 rounded-sm p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-blood">📣 New announcement</span>
          <button onClick={dismiss} className="font-mono text-xs text-neutral-500 hover:text-blood" aria-label="Close">✕</button>
        </div>
        <h2 className="font-mono text-xl text-white">{ann.title}</h2>
        <p className="text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto">
          {renderMessageContent(ann.body)}
        </p>
        {ann.link_url && (
          <a href={ann.link_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 font-mono text-xs text-[#38bdf8] hover:underline break-all">
            🔗 {ann.link_url}
          </a>
        )}
        {ann.attachment_key && (
          <button onClick={() => downloadFromR2(ann.attachment_key)}
            className="flex items-center gap-2 rounded-sm border border-blood/30 bg-ink-900/60 px-3 py-2 text-left hover:border-blood transition">
            <span className="text-lg shrink-0">📎</span>
            <span className="min-w-0">
              <span className="block text-xs text-neutral-200 truncate max-w-[280px]">{ann.attachment_name || "attachment"}</span>
              <span className="block text-[10px] text-neutral-500">Click to download ↗</span>
            </span>
          </button>
        )}
        <div className="flex justify-end pt-2">
          <button onClick={dismiss} className="btn-neon font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
