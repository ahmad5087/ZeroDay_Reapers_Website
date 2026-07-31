"use client";

import { useEffect, useState } from "react";

// Internship week since signup (1-based). Week 1 = first 7 days after joining.
function currentWeek(createdAt) {
  const start = new Date(createdAt || Date.now()).getTime();
  const w = Math.floor((Date.now() - start) / (7 * 24 * 3600 * 1000)) + 1;
  return Math.max(1, w);
}

// Week-3 fee-deadline reminder. Shows once per login session to INTERNS ONLY
// (founders, admins, and alumni never see it) and is skipped for anyone who has already
// submitted payment proof. The reminder preference (snooze to a later week / never) is stored
// per-user in localStorage; the once-per-session guard uses sessionStorage.
export default function FeeReminderPopup({ me, onGoToProfile }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("next"); // next | week2 | week3 | never

  const isIntern = me?.role === "student" && !me?.is_alumni && !me?.is_founder;
  const week = currentWeek(me?.created_at);
  const prefKey = `zdr_fee_pref_${me?.id}`;
  const seenKey = `zdr_fee_seen_${me?.id}`;

  useEffect(() => {
    if (!isIntern) return;               // interns only
    if (me?.payment_proof_url) return;   // already submitted — nothing to nag about
    try {
      if (sessionStorage.getItem(seenKey)) return; // already shown this login session
      const pref = localStorage.getItem(prefKey);
      if (pref === "never") return;
      if (pref === "week2" && week < 2) return;     // snoozed until Week 2
      if (pref === "week3" && week < 3) return;     // snoozed until Week 3
      // a satisfied snooze reverts to the default (nag every login) afterward
      if ((pref === "week2" && week >= 2) || (pref === "week3" && week >= 3)) localStorage.removeItem(prefKey);
      sessionStorage.setItem(seenKey, "1");
      setOpen(true);
    } catch { setOpen(true); } // storage blocked — still show the reminder
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  function close(save) {
    try {
      if (save) {
        if (choice === "never" || choice === "week2" || choice === "week3") localStorage.setItem(prefKey, choice);
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
            <p className="text-[11px] text-neutral-500 mt-0.5">You&apos;re currently in Week {week}</p>
          </div>
        </div>

        <div className="mt-4 text-sm text-neutral-300 leading-relaxed space-y-2">
          <p>Please submit your internship fee <span className="text-white font-bold">before Week 3 ends</span>.</p>
          <p className="text-[12px] text-neutral-400 bg-black/40 border-l-2 border-amber-500 rounded-r-sm p-3">
            ⚠️ If your payment isn&apos;t submitted in time, your account will be{" "}
            <span className="text-red-400 font-semibold">automatically removed at the start of Week 4</span>.
          </p>
        </div>

        <div className="mt-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-neutral-500">Remind me</div>
          {[
            ["next", "At my next login (default)"],
            ["week2", "In Week 2"],
            ["week3", "In Week 3"],
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
