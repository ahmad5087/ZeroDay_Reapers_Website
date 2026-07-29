"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Mandatory TOTP enrollment gate for admins. Blocks the portal until a verified factor exists.
// Enrollment is always reachable here, so an admin can never lock themselves out.
export default function Require2FA({ onDone, onSignOut }) {
  const [enrolling, setEnrolling] = useState(null); // { factorId, qr, secret }
  const [otp, setOtp] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    setErr(""); setBusy(true);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setBusy(false);
    if (error) return setErr(error.message);
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }
  async function confirm(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code: otp.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    onDone?.();
  }

  const input = "w-full bg-ink-900 border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16 font-mono">
      <div className="w-full max-w-md border border-blood/30 bg-black/40 backdrop-blur rounded-sm p-8 space-y-5">
        <div className="text-center space-y-1">
          <div className="text-3xl">🔐</div>
          <h1 className="text-white text-lg uppercase tracking-widest">Two-factor required</h1>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Admin accounts must enable two-factor authentication before continuing. Scan the QR with
            an authenticator app (Google Authenticator, Authy, 1Password…), then enter the code.
          </p>
        </div>

        {err && <p className="text-sm text-blood">{err}</p>}

        {!enrolling ? (
          <button onClick={start} disabled={busy} className="w-full bg-blood text-ink-950 uppercase tracking-widest text-xs py-3 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
            {busy ? "…" : "Set up 2FA →"}
          </button>
        ) : (
          <form onSubmit={confirm} className="space-y-4">
            {enrolling.qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={enrolling.qr} alt="2FA QR code" className="mx-auto w-44 h-44 bg-white p-2 rounded-sm" />
            )}
            <p className="text-[11px] text-neutral-500 break-all text-center">Manual key: {enrolling.secret}</p>
            <input className={input} inputMode="numeric" placeholder="6-digit code" required value={otp} onChange={(e) => setOtp(e.target.value)} />
            <button disabled={busy} className="w-full bg-blood text-ink-950 uppercase tracking-widest text-xs py-3 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
              {busy ? "…" : "Verify & continue →"}
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
