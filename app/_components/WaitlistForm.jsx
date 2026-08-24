"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Cohort waitlist form (Phase 12). Reads the `waitlist` flag: off → a friendly "not open" message,
// on → the join form (anon `join_waitlist` RPC). Self-contained; safe before the migration is applied.
export default function WaitlistForm() {
  const [on, setOn] = useState(null);
  const [form, setForm] = useState({ name: "", email: "" });
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("feature_flags").select("enabled").eq("key", "waitlist").maybeSingle();
        setOn(!!data?.enabled);
      } catch { setOn(false); }
    })();
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (!supabase) return setErr("Not configured.");
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("join_waitlist", { p_email: form.email.trim(), p_name: form.name.trim() || null, p_source: "apply" });
    setBusy(false);
    if (error) return setErr("Couldn't join — check your email and try again.");
    setDone(true);
  }

  if (on === null) return null;
  if (!on) return <p style={{ color: "#666", marginTop: 24 }}>Applications aren't open right now — join is closed. Follow us for the next cohort announcement.</p>;
  if (done) return <p style={{ color: "#0a7d38", marginTop: 24, fontWeight: 600 }}>You're on the waitlist — we'll email you when the next cohort opens.</p>;

  const input = { width: "100%", padding: "11px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 15, boxSizing: "border-box" };
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 24, maxWidth: 420 }}>
      <input style={input} placeholder="Your name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
      <input style={input} type="email" required placeholder="Email *" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
      <button disabled={busy} style={{ padding: "12px", background: "#e10600", color: "#fff", border: 0, borderRadius: 6, fontSize: 15, cursor: "pointer" }}>
        {busy ? "Joining…" : "Join the waitlist"}
      </button>
      {err && <p style={{ color: "#c00", fontSize: 13, margin: 0 }}>{err}</p>}
    </form>
  );
}
