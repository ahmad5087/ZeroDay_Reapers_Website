"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cohortOf } from "@/lib/cohort";

const WEEK_MS = 7 * 24 * 3600 * 1000;

// Cohort-relative internship week (1-based): Week 1 begins on the cohort's start date. Returns 0 before the
// cohort starts. Falls back to weeks-since-signup when the cohort has no start date set (pre-115 behaviour).
function internshipWeek(cohortStart, createdAt) {
  if (cohortStart) {
    const diff = Date.now() - new Date(cohortStart).getTime();
    if (diff < 0) return 0; // cohort hasn't started yet
    return Math.floor(diff / WEEK_MS) + 1;
  }
  const w = Math.floor((Date.now() - new Date(createdAt || Date.now()).getTime()) / WEEK_MS) + 1;
  return Math.max(1, w);
}

// Internship fee reminder. Shows once per login session to INTERNS ONLY (founders, admins, and alumni
// never see it) and is skipped for anyone who has already submitted payment proof. The fee is due BEFORE
// the Week 2 task — Week 2 onward stays locked until proof is uploaded (hard gate, enforced server-side in
// migration 117). The "current week" is cohort-relative (migration 115 cohort start), not signup-relative.
export default function FeeReminderPopup({ me, onGoToProfile }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("next"); // next | never
  const [cohortStart, setCohortStart] = useState(null);

  const isIntern = me?.role === "student" && !me?.is_alumni && !me?.is_founder;
  const prefKey = `zdr_fee_pref_${me?.id}`;
  const seenKey = `zdr_fee_seen_${me?.id}`;

  useEffect(() => {
    if (!isIntern) return;               // interns only
    if (me?.payment_proof_url) return;   // already submitted — nothing to nag about
    let cancelled = false;
    (async () => {
      // Cohort start drives the "current week" shown. app_settings is readable by any authenticated user;
      // cohort_starts is a { "<cohort>": "YYYY-MM-DD" } map (migration 115).
      const { data } = await supabase.from("app_settings").select("cohort_starts").eq("id", true).maybeSingle();
      const starts = data?.cohort_starts || {};
      const myC = cohortOf(me);
      if (cancelled) return;
      setCohortStart(myC && starts[myC] ? starts[myC] : null);
      try {
        if (sessionStorage.getItem(seenKey)) return; // already shown this login session
        if (localStorage.getItem(prefKey) === "never") return;
        sessionStorage.setItem(seenKey, "1");
        setOpen(true);
      } catch { setOpen(true); } // storage blocked — still show the reminder
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  const week = internshipWeek(cohortStart, me?.created_at);

  function close(save) {
    try {
      if (save) {
        if (choice === "never") localStorage.setItem(prefKey, "never");
        else localStorage.removeItem(prefKey); // "next" → default, show again next login
      }
    } catch { /* ignore */ }
    setOpen(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm" onClick={() => close(false)}>
      <div className="glass glass-red cyber-corners w-full max-w-md p-6 font-mono" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="text-3xl leading-none">💳</div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-widest text-amber-400">Internship Fee Reminder</h2>
            <p className="text-[11px] text-neutral-500 mt-0.5">
              {week === 0 ? "Your cohort hasn't started yet" : `You're currently in Week ${week}`}
            </p>
          </div>
        </div>

        <div className="mt-4 text-sm text-neutral-300 leading-relaxed space-y-2">
          <p>
            Submit your internship fee <span className="text-white font-bold">before the Week 2 task</span> —{" "}
            <span className="text-white font-bold">PKR 1,000</span> (Pakistan) or{" "}
            <span className="text-white font-bold">$5 USD</span> (international).
          </p>
          <p className="text-[12px] text-neutral-400 bg-black/40 border-l-2 border-amber-500 rounded-r-sm p-3">
            ⚠️ Week 1 is free, but <span className="text-red-400 font-semibold">Week 2 onward stays locked</span>{" "}
            until you upload your payment proof.
          </p>
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-neutral-500">Remind me</div>
          {[
            ["next", "At my next login (default)"],
            ["never", "Don't show this again"],
          ].map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer select-none">
              <input type="radio" name="feeRemind" value={val} checked={choice === val} onChange={() => setChoice(val)} className="accent-blood" />
              {label}
            </label>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2 justify-end">
          {onGoToProfile && (
            <button onClick={() => { close(true); onGoToProfile(); }} className="btn-neon text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg">
              Submit fee now →
            </button>
          )}
          <button onClick={() => close(true)} className="btn-ghost text-xs uppercase tracking-widest px-4 py-2.5 rounded-lg">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
