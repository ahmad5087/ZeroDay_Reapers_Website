"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Referral standings admin (Phase 11). Reads referral_leaderboard() (migration 098) — per referrer: total
// referred, how many became APPROVED students, and who they referred. This is the operational surface for
// all three reward models: recognition (rank by total), portal credit (per approved referral), and the
// "refer interns → become a community admin" path. Fulfilment is the founder's call; this shows the data.

const STATUS_TONE = {
  approved: "text-[#34d399]",
  pending: "text-amber-400",
  rejected: "text-blood",
  banned: "text-blood",
};

export default function ReferralAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState(null);

  async function load() {
    setLoading(true); setErr("");
    const { data, error } = await supabase.rpc("referral_leaderboard");
    setLoading(false);
    if (error) return setErr("Couldn't load referrals: " + error.message);
    setRows(Array.isArray(data) ? data : []);
  }
  useEffect(() => { load(); }, []);

  const totals = useMemo(() => {
    let referred = 0, approved = 0, applied = 0;
    for (const r of rows) { referred += r.total || 0; approved += r.approved || 0; applied += r.applied || 0; }
    return { referrers: rows.length, referred, approved, applied };
  }, [rows]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-lg text-white">Referrals · Standings</h2>
        <button onClick={load} className="font-mono text-[11px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-blood hover:text-blood transition">
          ↻ Refresh
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-blood/20 rounded-sm overflow-hidden">
        {[
          ["Referrers", totals.referrers],
          ["Applied", totals.applied],
          ["Joined", totals.referred],
          ["Approved", totals.approved],
        ].map(([k, v]) => (
          <div key={k} className="bg-ink-950 p-4">
            <div className="font-mono text-2xl text-blood">{v}</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mt-1">{k}</div>
          </div>
        ))}
      </div>

      <p className="text-neutral-500 text-xs leading-relaxed">
        Rank by <span className="text-neutral-300">Total</span> for recognition, use <span className="text-neutral-300">Approved</span> for
        any per-referral perk, and the top referrers are your candidates for a community-admin role. Fulfilment is manual.
      </p>

      {err && <p className="text-blood text-sm">{err}</p>}

      {loading ? (
        <p className="font-mono text-xs text-neutral-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-neutral-500 text-sm">No referrals yet. Referrals are attributed when someone signs up via an intern&apos;s <code className="text-[#38bdf8]">?ref=</code> link.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => {
            const open = openId === r.referrer_id;
            return (
              <li key={r.referrer_id} className="panel border border-blood/20 rounded-xl overflow-hidden">
                <button onClick={() => setOpenId(open ? null : r.referrer_id)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                  <span className="font-mono text-sm text-neutral-500 w-6">#{i + 1}</span>
                  <span className="flex-1 min-w-0">
                    <span className="text-white font-medium truncate">{r.name}</span>
                    {r.member_id && <span className="text-neutral-600 text-xs ml-2">{r.member_id}</span>}
                  </span>
                  <span className="font-mono text-xs text-neutral-400">{r.applied} applied</span>
                  <span className="font-mono text-xs text-neutral-300">{r.total} joined</span>
                  <span className="font-mono text-xs text-[#34d399]">{r.approved} approved</span>
                  <span className="text-neutral-600 text-xs">{open ? "▲" : "▼"}</span>
                </button>
                {open && (
                  <div className="border-t border-blood/10 bg-black/30 px-4 py-3">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Referred</div>
                    <ul className="flex flex-wrap gap-2">
                      {(r.referred || []).map((u, j) => (
                        <li key={j} className="text-xs border border-blood/15 rounded-sm px-2 py-1">
                          <span className="text-neutral-200">{u.name}</span>{" "}
                          <span className={STATUS_TONE[u.status] || "text-neutral-500"}>· {u.status}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
