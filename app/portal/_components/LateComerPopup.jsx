"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cohortOf } from "@/lib/cohort";

// One-time notice for an intern who registered more than a week after their cohort's start date.
// "Late comer" status is computed live against the founder-set cohort start (app_settings.cohort_starts,
// migration 115) — the SAME rule as the admin Late tag — NOT against a task's upload time, which is shared
// across cohorts and would flag every later cohort. Never fires before the cohort starts, and never when no
// start date is set for the cohort. Once dismissed, profiles.late_comer_ack is set so it never shows again.
const LATE_AFTER_DAYS = 7;

export default function LateComerPopup({ me, setMe }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isIntern = me?.role === "student" && !me?.is_alumni;
    if (!isIntern || me?.late_comer_ack || !me?.created_at) return;
    let cancelled = false;
    supabase.from("app_settings").select("cohort_starts").eq("id", true).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const start = (data?.cohort_starts || {})[cohortOf(me)];
        if (!start) return; // no start date for this cohort → late-tagging off
        const threshold = new Date(start).getTime() + LATE_AFTER_DAYS * 86400000;
        if (new Date(me.created_at).getTime() > threshold) setOpen(true);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  async function dismiss() {
    setOpen(false);
    setMe?.((m) => ({ ...m, late_comer_ack: true }));
    try { await supabase.from("profiles").update({ late_comer_ack: true }).eq("id", me.id); } catch { /* best-effort */ }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={dismiss}>
      <div className="glass glass-red cyber-corners w-full max-w-md p-6 font-mono" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none">⏱️</div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-widest text-amber-400">Heads up — you joined late</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">Registered after Week 1 started</p>
          </div>
        </div>

        <div className="mt-4 text-sm text-neutral-300 leading-relaxed space-y-2">
          <p>You registered <span className="text-white font-bold">more than a week after your cohort&apos;s Week 1 began</span>, so you&apos;re joining as a <span className="text-amber-400 font-semibold">late comer</span>.</p>
          <p className="text-[12px] text-neutral-400 bg-black/40 border-l-2 border-amber-500 rounded-r-sm p-3">
            Head to the <span className="text-white">Tasks</span> tab and catch up on any earlier task(s) as soon as you can. Reach out to an admin if you need guidance.
          </p>
        </div>

        <div className="mt-5 flex justify-end">
          <button onClick={dismiss} className="btn-neon text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg">Got it</button>
        </div>
      </div>
    </div>
  );
}
