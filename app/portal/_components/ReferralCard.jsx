"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Intern-facing referral share card (Phase 11). Gated by the `referrals` flag; renders null when off.
// Mints the intern's code via get_or_create_referral_code and shows a shareable link + their count.
export default function ReferralCard() {
  const [on, setOn] = useState(false);
  const [code, setCode] = useState(null);
  const [mine, setMine] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      const { data: flag } = await supabase.from("feature_flags").select("enabled").eq("key", "referrals").maybeSingle();
      if (stop || !flag?.enabled) return;
      setOn(true);
      const { data: c } = await supabase.rpc("get_or_create_referral_code");
      if (!stop) setCode(c || null);
      const { data: s } = await supabase.rpc("referral_stats");
      if (!stop && s) setMine(s.mine || 0);
    })();
    return () => { stop = true; };
  }, []);

  if (!on || !code) return null;
  const link = `${typeof window !== "undefined" ? window.location.origin : ""}/?ref=${code}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div className="panel border border-blood/20 rounded-sm p-5">
      <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-2">Refer a friend</h2>
      <p className="text-xs text-neutral-500 mb-3">
        Share your link — you've referred <span className="text-white font-bold">{mine}</span> so far.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <code className="font-mono text-[11px] text-[#38bdf8] break-all">{link}</code>
        <button onClick={copy} className="font-mono text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-2.5 py-1 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition">
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-[11px] text-neutral-500 mt-3 leading-relaxed">
        The more interns you refer who join, the better your chance to become a{" "}
        <span className="text-neutral-300">community admin</span> — and to work with the founder directly.
      </p>
    </div>
  );
}
