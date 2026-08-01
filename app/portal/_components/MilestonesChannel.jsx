"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { renderMessageContent } from "./LinkPreview";

// Read-only achievement board (First Blood + future badges). No composer for anyone — not even
// admins/founders. Entries are posted only by the emit_first_blood DB trigger (migration 053).
export default function MilestonesChannel({ me }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    supabase.from("milestones").select("*").order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => { if (!cancelled) setItems(data || []); });
    const ch = supabase.channel("milestones-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "milestones" },
        ({ new: m }) => setItems((p) => (p.some((x) => x.id === m.id) ? p : [m, ...p])))
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="border-b border-blood/10 px-4 py-3 shrink-0">
        <h2 className="font-mono text-sm uppercase tracking-widest text-amber-400">🏆 Milestones</h2>
        <p className="font-mono text-[11px] text-neutral-500">Auto-posted achievements — First Blood and other badges. Read-only.</p>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {items.length === 0 ? (
          <p className="font-mono text-xs text-neutral-500">No milestones yet — be the first to clear a task. 🩸</p>
        ) : (
          items.map((m) => (
            <article key={m.id} className="border border-amber-500/25 rounded-sm p-4 bg-ink-900/40">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-mono text-white">{m.title}</h3>
                <span className="font-mono text-[10px] text-neutral-600 shrink-0">
                  {new Date(m.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                </span>
              </div>
              <p className="mt-1 text-sm text-neutral-300 whitespace-pre-wrap leading-relaxed">{renderMessageContent(m.body)}</p>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
