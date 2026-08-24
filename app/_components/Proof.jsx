"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Live proof / trust band (Phase 11 — growth). Reads non-PII aggregates from the anon `get_public_stats`
// RPC (migration 084) and shows them as stat tiles. Self-gating: renders nothing until the RPC exists
// and returns non-zero data, so it's safe to leave mounted before the migration is applied.
const TILES = [
  { key: "interns_trained", label: "Interns trained" },
  { key: "certificates_issued", label: "Certificates issued" },
  { key: "deliverables_approved", label: "Deliverables approved" },
  { key: "projects_delivered", label: "Projects delivered" },
];

export default function Proof() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const { data, error } = await supabase.rpc("get_public_stats");
        if (!stop && !error) setStats(data || null);
      } catch { /* RPC not deployed yet — stay hidden */ }
    })();
    return () => { stop = true; };
  }, []);

  if (!stats) return null;
  const shown = TILES.filter((t) => Number(stats[t.key] || 0) > 0);
  if (shown.length === 0) return null;

  return (
    <section id="proof" className="relative max-w-6xl mx-auto px-6 py-24 border-t border-blood/10">
      <div className="mb-10">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-blood">By the numbers</span>
        <h2 className="mt-3 text-3xl sm:text-4xl font-bold text-white">Proof, not promises</h2>
        <p className="mt-3 max-w-xl text-neutral-400">
          Live from our own portal — interns trained, work shipped, and clients delivered.
        </p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {shown.map((t) => (
          <div key={t.key} className="border border-blood/20 rounded-sm bg-ink-900/30 p-6">
            <div className="text-4xl font-bold text-white tabular-nums">{Number(stats[t.key]).toLocaleString()}</div>
            <div className="mt-2 font-mono text-[11px] uppercase tracking-widest text-neutral-500">{t.label}</div>
          </div>
        ))}
      </div>
      <p className="mt-6 font-mono text-xs text-neutral-500">
        Every certificate is verifiable — <a href="/verify" className="text-neon-cyan hover:underline">check one here</a>.
      </p>
    </section>
  );
}
