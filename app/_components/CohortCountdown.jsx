"use client";

import { useEffect, useState } from "react";

// Live countdown to the next cohort start (Phase 12 — apply funnel). Renders stable placeholders on the
// server / first paint to avoid hydration mismatch, then ticks every second on the client. When the target
// has passed it swaps to an "open now" banner. Purely presentational — takes an ISO `target` string.
export default function CohortCountdown({ target }) {
  const targetMs = new Date(target).getTime();
  const [left, setLeft] = useState(null);

  useEffect(() => {
    const tick = () => setLeft(Math.max(0, targetMs - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  const started = left != null && left <= 0;
  const s = Math.floor((left ?? 0) / 1000);
  const units = [
    { label: "Days", value: Math.floor(s / 86400) },
    { label: "Hours", value: Math.floor((s % 86400) / 3600) },
    { label: "Minutes", value: Math.floor((s % 3600) / 60) },
    { label: "Seconds", value: s % 60 },
  ];

  if (started) {
    return (
      <div className="mt-8 inline-flex items-center gap-3 border border-blood/40 bg-blood/10 px-5 py-3 rounded-lg">
        <span className="h-2.5 w-2.5 rounded-full bg-blood animate-glow-pulse" />
        <span className="font-mono text-sm uppercase tracking-widest text-white">
          Cohort 2 is live — register below
        </span>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="font-mono text-[11px] uppercase tracking-[0.35em] text-neutral-500 mb-3">
        Cohort 2 begins in
      </div>
      <div className="flex gap-3 sm:gap-4">
        {units.map((u) => (
          <div
            key={u.label}
            className="flex-1 sm:flex-none sm:w-24 text-center border border-blood/20 bg-black/40 rounded-xl px-2 py-3 sm:px-4 sm:py-4"
          >
            <div className="font-mono text-3xl sm:text-5xl font-bold text-white text-glow tabular-nums">
              {left == null ? "––" : String(u.value).padStart(2, "0")}
            </div>
            <div className="mt-1 font-mono text-[10px] sm:text-xs uppercase tracking-widest text-neutral-500">
              {u.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
