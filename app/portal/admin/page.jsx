"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import AdminPanel from "../_components/AdminPanel";

export default function AdminLoginPage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null);

  useEffect(() => {
    if (!supabaseConfigured) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setMe(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    let stop = false;
    supabase.from("profiles").select("id,email,display_name,role,avatar_url").eq("id", session.user.id).single()
      .then(({ data }) => { if (!stop) setMe(data); });
    return () => { stop = true; };
  }, [session]);

  async function signOut() { await supabase.auth.signOut(); setMe(null); }

  if (!ready) return <Center>Loading…</Center>;
  if (!supabaseConfigured) return <Center>Portal not configured — see PORTAL_SETUP.md</Center>;

  if (session && me) {
    if (me.role === "admin") {
      return <AdminPanel me={me} setMe={setMe} onBack={() => { window.location.href = "/portal"; }} />;
    }
    // Signed in but not an admin — refuse and offer sign out.
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm border border-blood/30 rounded-sm p-8 text-center font-mono text-sm">
          <h1 className="text-white text-lg mb-3">Not an admin</h1>
          <p className="text-neutral-400 mb-6">This account doesn&apos;t have admin access.</p>
          <button onClick={signOut} className="border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition uppercase tracking-widest text-xs">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (session && !me) return <Center>Checking access…</Center>;
  return <AdminLogin />;
}

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [mfa, setMfa] = useState(null); // { factorId } when a 2FA code is required
  const [otp, setOtp] = useState("");

  async function onLogin(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) { setBusy(false); return setErr(error.message); }
    // If this admin has 2FA enabled, they must complete a TOTP challenge to reach aal2.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2") {
      const { data: f } = await supabase.auth.mfa.listFactors();
      const factor = (f?.totp || [])[0];
      setBusy(false);
      if (factor) return setMfa({ factorId: factor.id });
    }
    setBusy(false);
  }

  async function onVerifyMfa(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: mfa.factorId, code: otp.trim() });
    setBusy(false);
    if (error) return setErr(error.message);
    setMfa(null); setOtp("");
    // session is now aal2 — the page's auth listener will load the admin panel
  }

  const input = "w-full bg-ink-900 border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-8">
          <img src="/logo.svg" alt="" width={40} height={40} className="h-10 w-10 animate-glow-pulse" />
          <span className="font-mono text-sm tracking-widest text-white text-glow">
            ADMIN · ZERO<span className="text-blood">DAY</span> REAPERS
          </span>
        </div>

        {mfa ? (
          <form onSubmit={onVerifyMfa} className="border border-blood/20 bg-black/40 backdrop-blur rounded-sm p-8 space-y-4 font-mono text-sm">
            <p className="text-neutral-500 text-xs uppercase tracking-widest">Two-factor code</p>
            {err && <p className="text-sm text-blood">{err}</p>}
            <input className={input} inputMode="numeric" placeholder="6-digit code from your app" required value={otp} onChange={(e) => setOtp(e.target.value)} />
            <button disabled={busy} className="w-full bg-blood text-ink-950 uppercase tracking-widest py-3 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
              {busy ? "…" : "Verify →"}
            </button>
          </form>
        ) : (
          <form onSubmit={onLogin} className="border border-blood/20 bg-black/40 backdrop-blur rounded-sm p-8 space-y-4 font-mono text-sm">
            <p className="text-neutral-500 text-xs uppercase tracking-widest">Admin sign in</p>
            {err && <p className="text-sm text-blood">{err}</p>}
            <input className={input} type="email" placeholder="Admin email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className={input} type="password" placeholder="Password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button disabled={busy} className="w-full bg-blood text-ink-950 uppercase tracking-widest py-3 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
              {busy ? "…" : "Sign in →"}
            </button>
            <p className="text-xs text-neutral-600 leading-relaxed">
              Admin accounts are provisioned by the founder. There is no admin self-signup.
            </p>
          </form>
        )}

        <a href="/portal" className="block text-center mt-6 font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-blood">
          ← Student portal
        </a>
      </div>
    </div>
  );
}

function Center({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 animate-pulse">{children}</p>
    </div>
  );
}
