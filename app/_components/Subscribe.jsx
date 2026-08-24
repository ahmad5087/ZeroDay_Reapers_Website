"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Newsletter capture (Phase 11). Posts to the anon `subscribe` RPC (migration 087). Self-contained;
// if the RPC isn't deployed yet it just shows a friendly error and no email is stored.
export default function Subscribe({ source = "insights" }) {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!supabase) return setErr("Not configured.");
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("subscribe", { p_email: email.trim(), p_source: source });
    setBusy(false);
    if (error) return setErr("Couldn't subscribe — check the email and try again.");
    setDone(true);
  }

  if (done) return <p style={{ color: "#0a7d38", marginTop: 20, fontWeight: 600 }}>Thanks — you're on the list.</p>;

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
      <input
        type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
        style={{ flex: "1 1 220px", padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 15, boxSizing: "border-box" }}
      />
      <button disabled={busy} style={{ padding: "10px 18px", background: "#e10600", color: "#fff", border: 0, borderRadius: 6, fontSize: 15, cursor: "pointer" }}>
        {busy ? "…" : "Subscribe"}
      </button>
      {err && <p style={{ color: "#c00", flexBasis: "100%", fontSize: 13, margin: "4px 0 0" }}>{err}</p>}
    </form>
  );
}
