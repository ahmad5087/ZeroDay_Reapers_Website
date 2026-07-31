"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// One-time notice for an intern who signed up AFTER their department's Week-1 task was posted.
// "Late comer" status is computed live (signup time vs that task's upload time). Once the intern
// dismisses this, profiles.late_comer_ack is set so it never shows again (once per account).
export default function LateComerPopup({ me, setMe }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const isIntern = me?.role === "student" && !me?.is_alumni;
    if (!isIntern || me?.late_comer_ack || !me?.domain_id || !me?.created_at) return;
    let cancelled = false;
    // Earliest Week-1 task for THEIR department.
    supabase.from("tasks").select("created_at").eq("week", 1).eq("domain_id", me.domain_id)
      .order("created_at", { ascending: true }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.created_at) return;
        if (new Date(me.created_at).getTime() > new Date(data.created_at).getTime()) setOpen(true);
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
          <p>You registered <span className="text-white font-bold">after your department&apos;s Week 1 task was released</span>, so you&apos;re joining as a <span className="text-amber-400 font-semibold">late comer</span>.</p>
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
