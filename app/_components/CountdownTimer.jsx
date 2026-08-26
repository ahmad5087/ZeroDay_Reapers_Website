"use client";

import { useEffect, useState } from "react";

// Cohort 2 begins 1st October 2026, local midnight — registrations are open until then. The banner links
// to /apply (the on-site application; the `waitlist` feature flag is the real open/close gate there).
// Change the date here if the cohort moves.
const TARGET = new Date(2026, 9, 1, 0, 0, 0).getTime(); // month is 0-indexed → 9 = October

function remaining() {
  const ms = TARGET - Date.now();
  if (ms <= 0) return null; // cohort has started
  const s = Math.floor(ms / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

// Full-width banner strip shown directly under the nav — Cohort 2 registrations are open.
export default function CountdownTimer() {
  // undefined = not computed yet (SSR/first paint), null = cohort started, object = counting down.
  const [t, setT] = useState(undefined);

  useEffect(() => {
    const tick = () => setT(remaining());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const pad = (n) => String(n).padStart(2, "0");
  const clock = t ? `${t.days}d : ${pad(t.hours)}h : ${pad(t.minutes)}m : ${pad(t.seconds)}s` : null;

  return (
    <div className="w-full bg-blood text-ink-950 border-b border-black/25">
      <a
        href="/apply"
        className="max-w-6xl mx-auto px-6 py-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 font-mono text-[11px] sm:text-xs uppercase tracking-widest hover:opacity-90 transition"
      >
        <span className="font-bold">🎯 Cohort 2 registrations are open</span>
        {clock && (
          <>
            <span className="hidden sm:inline opacity-50">—</span>
            <span className="tabular-nums font-bold tracking-wider">Starts in {clock}</span>
          </>
        )}
        <span className="underline underline-offset-2 font-bold">Register →</span>
      </a>
    </div>
  );
}
