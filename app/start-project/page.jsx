"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// Public service-request intake (Phase 8, #9) — replaces plain contact inquiries with a structured
// scope questionnaire. Submits via the anon `submit_service_request` RPC and returns a private
// engagement link the client can use to track status.
const TYPES = ["Penetration test", "Security audit", "Red team", "Consulting", "Training", "Other"];
const BUDGETS = ["< $1k", "$1k–$5k", "$5k–$15k", "$15k+", "Not sure"];
const TIMELINES = ["ASAP", "2–4 weeks", "1–3 months", "Flexible"];

export default function StartProjectPage() {
  const [form, setForm] = useState({ name: "", email: "", org: "", title: "", type: TYPES[0], budget: BUDGETS[0], timeline: TIMELINES[0], description: "" });
  const [token, setToken] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!supabase) return setErr("This form is not configured.");
    if (!form.title.trim() || !form.email.trim()) return setErr("Project title and email are required.");
    setErr(""); setBusy(true);
    const { data, error } = await supabase.rpc("submit_service_request", {
      p_name: form.name.trim() || null, p_email: form.email.trim(), p_org: form.org.trim() || null, p_title: form.title.trim(),
      p_scope: { type: form.type, budget: form.budget, timeline: form.timeline, description: form.description.trim() },
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setToken(data);
  }

  const input = { width: "100%", padding: "10px 12px", border: "1px solid #ccc", borderRadius: 6, fontSize: 15, boxSizing: "border-box" };
  const wrap = { maxWidth: 640, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, Segoe UI, Arial, sans-serif" };

  if (token) {
    const link = `/engagement/${token}`;
    return (
      <main style={wrap}>
        <h1 style={{ marginBottom: 8 }}>Request received</h1>
        <p style={{ color: "#555" }}>Thanks — we'll be in touch. Bookmark your private engagement link to track status and our updates:</p>
        <p style={{ margin: "12px 0" }}><Link href={link} style={{ color: "#e10600", fontWeight: 600 }}>{link}</Link></p>
        <p style={{ color: "#888", fontSize: 13 }}>Keep this link private — anyone with it can view your engagement.</p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <h1 style={{ marginBottom: 6 }}>Start a project</h1>
      <p style={{ color: "#666", marginBottom: 24 }}>Tell us about your security needs and we'll scope it out.</p>
      {err && <p style={{ color: "#c00" }}>{err}</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
        <input style={input} placeholder="Your name" value={form.name} onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))} />
        <input style={input} placeholder="Email *" value={form.email} onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))} />
        <input style={input} placeholder="Organisation" value={form.org} onChange={(e) => setForm((s) => ({ ...s, org: e.target.value }))} />
        <input style={input} placeholder="Project title *" value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} />
        <label style={{ fontSize: 13, color: "#666" }}>Type
          <select style={input} value={form.type} onChange={(e) => setForm((s) => ({ ...s, type: e.target.value }))}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label style={{ fontSize: 13, color: "#666" }}>Budget
          <select style={input} value={form.budget} onChange={(e) => setForm((s) => ({ ...s, budget: e.target.value }))}>{BUDGETS.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <label style={{ fontSize: 13, color: "#666" }}>Timeline
          <select style={input} value={form.timeline} onChange={(e) => setForm((s) => ({ ...s, timeline: e.target.value }))}>{TIMELINES.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
        <textarea style={{ ...input, minHeight: 120, resize: "vertical" }} placeholder="Describe your project" value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
        <button disabled={busy} style={{ padding: "12px", background: "#e10600", color: "#fff", border: 0, borderRadius: 6, fontSize: 15, cursor: "pointer" }}>{busy ? "Submitting…" : "Submit request"}</button>
      </form>
    </main>
  );
}
