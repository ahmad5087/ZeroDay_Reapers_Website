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

function Cell({ value, label }) {
  return (
    <div className="border border-blood/30 bg-ink-950/80 rounded-sm py-4 md:py-5 text-center">
      <div className="font-mono text-3xl md:text-5xl text-white tabular-nums text-glow leading-none">{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500 mt-2">{label}</div>
    </div>
  );
}

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

  return (
    <div className="mb-14 border border-blood/20 bg-black/40 rounded-sm p-6 md:p-8">
      <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-3">// countdown to launch</div>
      {t === null ? (
        <div>
          <h3 className="font-mono text-2xl md:text-3xl text-white">
            The internship is <span className="text-blood">live</span>. 🎯
          </h3>
          <p className="mt-3 text-neutral-400 text-sm">Cohort has begun — register to join the next intake.</p>
        </div>
      ) : (
        <>
          <h3 className="font-mono text-xl md:text-2xl text-white mb-6">
            Internship begins <span className="text-blood">August 1, 2026</span>
          </h3>
          <div className="grid grid-cols-4 gap-2 md:gap-3 max-w-xl">
            <Cell value={t === undefined ? "--" : t.days} label="Days" />
            <Cell value={t === undefined ? "--" : pad(t.hours)} label="Hours" />
            <Cell value={t === undefined ? "--" : pad(t.minutes)} label="Minutes" />
            <Cell value={t === undefined ? "--" : pad(t.seconds)} label="Seconds" />
          </div>
        </>
      )}
    </div>
  );
}
