"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Icon + human label for each activity type.
const TYPES = {
  login: { icon: "🔓", color: "#a1a1aa", label: () => "Logged in" },
  submission_created: { icon: "📤", color: "#38bdf8", label: (m) => `Submitted a task${m?.week ? ` · Week ${m.week}` : ""}` },
  submission_graded: {
    icon: (m) => (m?.status === "approved" ? "✅" : "🔴"),
    color: "#34d399",
    label: (m) => `Submission ${m?.status === "rejected" ? "needs changes" : m?.status || "reviewed"}`,
  },
  graduated: { icon: "🎓", color: "#38bdf8", label: () => "Graduated to Alumni" },
  password_changed: { icon: "🔑", color: "#f59e0b", label: () => "Password changed" },
  new_device: { icon: "🖥️", color: "#f59e0b", label: () => "New device signed in" },
};

function relTime(ts) {
  const d = new Date(ts).getTime();
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  try { return new Date(ts).toLocaleDateString([], { dateStyle: "medium" }); } catch { return ""; }
}

export default function ActivityScreen({ me, onBack }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from("activity_events").select("*").eq("user_id", me.id)
      .order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => { setEvents(data || []); setLoading(false); });
  }, [me.id]);

  const fmt = (ts) => { try { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } };

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Activity timeline</h1>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 font-mono">
        {loading ? (
          <p className="text-center text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-16">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-center text-sm text-neutral-500 py-16">No activity yet. Your logins, submissions, reviews, and milestones will appear here.</p>
        ) : (
          <ol className="relative border-l border-neutral-800 ml-3">
            {events.map((e) => {
              const t = TYPES[e.type] || { icon: "•", color: "#a1a1aa", label: () => e.type };
              const icon = typeof t.icon === "function" ? t.icon(e.meta) : t.icon;
              return (
                <li key={e.id} className="mb-6 ml-6">
                  <span className="absolute -left-3 flex items-center justify-center w-6 h-6 rounded-full bg-ink-900 border border-neutral-700 text-xs">
                    {icon}
                  </span>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm text-neutral-200">{t.label(e.meta)}</p>
                    <time className="text-[11px] text-neutral-500 shrink-0" title={fmt(e.created_at)}>{relTime(e.created_at)}</time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </div>
  );
}
