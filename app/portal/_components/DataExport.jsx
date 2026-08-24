"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Self-serve GDPR data export (Phase 17). Calls the own-rows-only `export_my_data` RPC and downloads it as
// JSON. No-ops quietly if the RPC isn't deployed yet.
export default function DataExport() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function download() {
    setBusy(true); setErr("");
    try {
      const { data, error } = await supabase.rpc("export_my_data");
      if (error || !data) { setErr("Couldn't prepare your export — try again shortly."); return; }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zdr-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setErr("Couldn't prepare your export — try again shortly."); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel border border-blood/15 rounded-sm p-5">
      <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-2">Your data</h2>
      <p className="text-xs text-neutral-500 mb-3">Download everything we hold about you — profile, submissions, and activity — as a JSON file.</p>
      <button onClick={download} disabled={busy}
        className="font-mono text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-3 py-2 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition disabled:opacity-50">
        {busy ? "Preparing…" : "⬇ Download my data"}
      </button>
      {err && <p className="text-[11px] text-blood mt-2">{err}</p>}
    </div>
  );
}
