"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { startAuthentication } from "@simplewebauthn/browser";

// Login step-up gate (Phase 5). Shown only when the signed-in user opted into `passkey_required`
// and the `passkeys` flag is on. The Supabase session already exists (password login); this just
// requires a passkey assertion OR a recovery code before entering. Recovery codes prevent lockout.
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

export default function PasskeyGate({ me, onDone, onSignOut }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);
  const [code, setCode] = useState("");

  async function verifyPasskey() {
    setErr(""); setBusy(true);
    try {
      const opt = await authedPost("/api/webauthn/authenticate/options");
      if (!opt.ok) throw new Error(opt.json.error || "No passkeys enrolled");
      const asr = await startAuthentication({ optionsJSON: opt.json });
      const ver = await authedPost("/api/webauthn/authenticate/verify", { response: asr });
      if (!ver.ok || !ver.json.verified) throw new Error(ver.json.error || "Verification failed");
      onDone?.();
    } catch (e) { setErr(e.message || "Verification cancelled."); }
    setBusy(false);
  }

  async function verifyRecovery(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const r = await authedPost("/api/webauthn/recovery", { action: "verify", code });
    setBusy(false);
    if (!r.ok || !r.json.verified) return setErr("Invalid or already-used recovery code.");
    onDone?.();
  }

  const input = "w-full panel border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm font-mono";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16 font-mono">
      <div className="w-full max-w-md glass glass-red cyber-corners p-8 space-y-5">
        <div className="text-center space-y-1">
          <div className="text-3xl">🗝</div>
          <h1 className="text-white text-lg uppercase tracking-widest">Confirm it's you</h1>
          <p className="text-xs text-neutral-400 leading-relaxed">
            You enabled passkey sign-in. Verify with your passkey to continue{me?.display_name ? `, ${me.display_name}` : ""}.
          </p>
        </div>

        {err && <p className="text-sm text-blood text-center">{err}</p>}

        {!useRecovery ? (
          <>
            <button onClick={verifyPasskey} disabled={busy} className="w-full btn-neon uppercase tracking-widest text-xs py-3 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
              {busy ? "…" : "Verify with passkey →"}
            </button>
            <button onClick={() => { setUseRecovery(true); setErr(""); }} className="w-full text-xs uppercase tracking-widest text-neutral-500 hover:text-blood">
              Use a recovery code
            </button>
          </>
        ) : (
          <form onSubmit={verifyRecovery} className="space-y-4">
            <input className={input} placeholder="XXXXX-XXXXX" required value={code} onChange={(e) => setCode(e.target.value)} />
            <button disabled={busy} className="w-full btn-neon uppercase tracking-widest text-xs py-3 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
              {busy ? "…" : "Verify code →"}
            </button>
            <button type="button" onClick={() => { setUseRecovery(false); setErr(""); }} className="w-full text-xs uppercase tracking-widest text-neutral-500 hover:text-blood">
              Back to passkey
            </button>
          </form>
        )}

        <button onClick={onSignOut} className="w-full text-xs uppercase tracking-widest text-neutral-500 hover:text-blood">
          Sign out
        </button>
      </div>
    </div>
  );
}
