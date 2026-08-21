"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

// Passkey enrollment + management (Phase 5), mounted in ProfileScreen behind the `passkeys` flag.
// Additive: enroll passkeys, test sign-in, generate recovery codes, and optionally require a passkey
// at sign-in (recovery codes remain the fallback, so this can never lock the user out).
async function authedPost(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export default function PasskeySettings({ me }) {
  const [enabled, setEnabled] = useState(null); // null=loading, false=flag off
  const [creds, setCreds] = useState([]);
  const [recoveryLeft, setRecoveryLeft] = useState(null);
  const [required, setRequired] = useState(!!me?.passkey_required);
  const [codes, setCodes] = useState(null);
  const [nickname, setNickname] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data: flag } = await supabase.from("feature_flags").select("enabled").eq("key", "passkeys").maybeSingle();
    if (!flag?.enabled) { setEnabled(false); return; }
    setEnabled(true);
    const [{ data: c }, { data: rc }] = await Promise.all([
      supabase.from("webauthn_credentials").select("id,nickname,device_type,created_at,last_used_at").eq("user_id", me.id).order("created_at", { ascending: false }),
      supabase.rpc("recovery_codes_remaining"),
    ]);
    setCreds(c || []);
    setRecoveryLeft(typeof rc === "number" ? rc : (rc ?? 0));
  }
  useEffect(() => { load(); }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function addPasskey() {
    setErr(""); setOk(""); setBusy(true);
    try {
      const opt = await authedPost("/api/webauthn/register/options");
      if (!opt.ok) throw new Error(opt.json.error || "Could not start enrollment");
      const attResp = await startRegistration({ optionsJSON: opt.json });
      const ver = await authedPost("/api/webauthn/register/verify", { response: attResp, nickname });
      if (!ver.ok || !ver.json.verified) throw new Error(ver.json.error || "Verification failed");
      setOk("Passkey added."); setNickname(""); load();
    } catch (e) { setErr(e.message || "Enrollment cancelled."); }
    setBusy(false);
  }

  async function testPasskey() {
    setErr(""); setOk(""); setBusy(true);
    try {
      const opt = await authedPost("/api/webauthn/authenticate/options");
      if (!opt.ok) throw new Error(opt.json.error || "No passkeys to test");
      const asrResp = await startAuthentication({ optionsJSON: opt.json });
      const ver = await authedPost("/api/webauthn/authenticate/verify", { response: asrResp });
      if (!ver.ok || !ver.json.verified) throw new Error(ver.json.error || "Verification failed");
      setOk("✓ Passkey verified — sign-in works."); load();
    } catch (e) { setErr(e.message || "Verification cancelled."); }
    setBusy(false);
  }

  async function removeCred(id) {
    setErr(""); setOk("");
    const { error } = await supabase.from("webauthn_credentials").delete().eq("id", id).eq("user_id", me.id);
    if (error) return setErr(error.message);
    load();
  }

  async function genRecovery() {
    setErr(""); setOk(""); setBusy(true);
    const r = await authedPost("/api/webauthn/recovery", { action: "generate" });
    setBusy(false);
    if (!r.ok) return setErr(r.json.error || "Could not generate codes");
    setCodes(r.json.codes || []); load();
  }

  async function toggleRequired(next) {
    if (next && creds.length === 0) return setErr("Add a passkey before requiring it at sign-in.");
    setErr(""); setOk("");
    const { error } = await supabase.from("profiles").update({ passkey_required: next }).eq("id", me.id);
    if (error) return setErr(error.message);
    setRequired(next);
    setOk(next ? "A passkey will be required at your next sign-in." : "Passkey no longer required at sign-in.");
  }

  if (enabled !== true) return null; // flag off or still loading

  return (
    <section className="panel border border-blood/20 p-6 rounded-sm shadow-xl">
      <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3 mb-4 flex items-center gap-2">🗝 Passkeys</h3>
      {err && <p className="text-sm text-blood mb-3">{err}</p>}
      {ok && <p className="text-sm text-[#34d399] mb-3">{ok}</p>}

      <div className="space-y-3 max-w-lg">
        {creds.length === 0 ? (
          <p className="text-xs text-neutral-500">No passkeys yet. Add one to sign in with your fingerprint, face, or a security key.</p>
        ) : creds.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 border border-neutral-800 rounded-sm px-3 py-2">
            <div className="min-w-0">
              <div className="text-xs text-white truncate">{c.nickname || "Passkey"}{c.device_type ? ` · ${c.device_type}` : ""}</div>
              <div className="text-[10px] text-neutral-600">Added {new Date(c.created_at).toLocaleDateString()}{c.last_used_at ? ` · last used ${new Date(c.last_used_at).toLocaleDateString()}` : ""}</div>
            </div>
            <button onClick={() => removeCred(c.id)} className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-blood">Remove</button>
          </div>
        ))}

        <div className="flex gap-2 flex-wrap items-center">
          <input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Name (optional)" className="panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm text-sm" />
          <button disabled={busy} onClick={addPasskey} className="btn-neon text-xs uppercase tracking-widest px-4 py-2 rounded-sm disabled:opacity-50">Add a passkey</button>
          {creds.length > 0 && <button disabled={busy} onClick={testPasskey} className="text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition disabled:opacity-50">Test</button>}
        </div>

        <div className="border-t border-neutral-800 pt-3 space-y-2">
          <label className="flex items-center gap-2 text-xs text-neutral-300">
            <input type="checkbox" checked={required} onChange={(e) => toggleRequired(e.target.checked)} className="accent-blood" />
            Require a passkey at sign-in <span className="text-neutral-600">(recovery codes still work)</span>
          </label>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] text-neutral-500">Recovery codes left: {recoveryLeft ?? "—"}</span>
            <button disabled={busy} onClick={genRecovery} className="text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-blood hover:text-blood transition disabled:opacity-50">Generate recovery codes</button>
          </div>
          {codes && (
            <div className="border border-amber-500/40 bg-amber-500/5 rounded-sm p-3">
              <p className="text-[11px] text-amber-400 mb-2">Save these now — they won't be shown again. Each works once.</p>
              <div className="grid grid-cols-2 gap-1 font-mono text-xs text-neutral-200">{codes.map((c) => <span key={c}>{c}</span>)}</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
