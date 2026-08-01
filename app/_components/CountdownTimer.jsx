"use client";

import { useEffect, useState } from "react";

// Internship launch — 1st August 2026, local midnight. Change here if the date moves.
const TARGET = new Date(2026, 7, 1, 0, 0, 0).getTime(); // month is 0-indexed → 7 = August

function remaining() {
  const ms = TARGET - Date.now();
  if (ms <= 0) return null; // launched
  const s = Math.floor(ms / 1000);
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

// Full-width sale-banner strip shown directly under the nav.
export default function CountdownTimer() {
  // undefined = not computed yet (SSR/first paint), null = launched, object = counting down.
  const [t, setT] = useState(undefined);

  useEffect(() => {
    const tick = () => setT(remaining());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const pad = (n) => String(n).padStart(2, "0");
  const clock =
    t === undefined ? "-- : -- : -- : --"
    : t === null ? null
    : `${t.days}d : ${pad(t.hours)}h : ${pad(t.minutes)}m : ${pad(t.seconds)}s`;

  return (
    <div className="w-full bg-blood text-ink-950 border-b border-black/25">
      <a
        href="#internships"
        className="max-w-6xl mx-auto px-6 py-2.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 font-mono text-[11px] sm:text-xs uppercase tracking-widest hover:opacity-90 transition"
      >
        {t === null ? (
          <span className="font-bold">🔒 Internships are closed</span>
        ) : (
          <>
            <span className="font-bold">⚡ Internship launches August 1, 2026</span>
            <span className="hidden sm:inline opacity-50">—</span>
            <span className="tabular-nums font-bold tracking-wider">{clock}</span>
            <span className="underline underline-offset-2 font-bold">Register →</span>
          </>
        )}
      </a>
    </div>
  );
}
