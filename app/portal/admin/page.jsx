"use client";

import { useEffect, useRef, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import AdminPanel from "../_components/AdminPanel";
import Require2FA from "../_components/Require2FA";

// Cloudflare Turnstile (public site key; safe to ship). Must match AuthScreen —
// Supabase enforces CAPTCHA on every password sign-in, admin login included.
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAD-uyq_gi8HfhgxA";

export default function AdminLoginPage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null);
  const [has2FA, setHas2FA] = useState(null); // null=checking, true/false

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
    supabase.from("profiles").select("id,email,display_name,role,avatar_url,is_founder").eq("id", session.user.id).single()
      .then(({ data }) => { if (!stop) setMe(data); });
    return () => { stop = true; };
  }, [session]);

  // Admins must have verified 2FA before the panel loads.
  useEffect(() => {
    if (!me || me.role !== "admin") return;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      setHas2FA((data?.totp || []).some((f) => f.status === "verified"));
    });
  }, [me?.id, me?.role]);

  async function signOut() { await supabase.auth.signOut(); setMe(null); }

  if (!ready) return <Center>Loading…</Center>;
  if (!supabaseConfigured) return <Center>Portal not configured — see PORTAL_SETUP.md</Center>;

  if (session && me) {
    if (me.role === "admin") {
      if (has2FA === null) return <Center>Checking security…</Center>;
      if (has2FA === false) return <Require2FA onDone={() => setHas2FA(true)} onSignOut={signOut} />;
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

  // Turnstile captcha (Supabase requires a token on password sign-in).
  const [captcha, setCaptcha] = useState("");
  const widgetEl = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    function render() {
      if (!widgetEl.current || !window.turnstile || widgetId.current !== null) return;
      widgetId.current = window.turnstile.render(widgetEl.current, {
        sitekey: TURNSTILE_SITE_KEY,
        theme: "dark",
        callback: (t) => setCaptcha(t),
        "expired-callback": () => setCaptcha(""),
        "error-callback": () => setCaptcha(""),
      });
    }
    if (window.turnstile) { render(); return; }
    let s = document.querySelector(`script[src="${SRC}"]`);
    if (!s) {
      s = document.createElement("script");
      s.src = SRC; s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
    s.addEventListener("load", render);
    return () => s.removeEventListener("load", render);
  }, []);

  function resetCaptcha() {
    setCaptcha("");
    if (window.turnstile && widgetId.current !== null) window.turnstile.reset(widgetId.current);
  }

  async function onLogin(e) {
    e.preventDefault();
    setErr("");
    if (!captcha) return setErr("Please complete the captcha.");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(), password, options: { captchaToken: captcha },
    });
    resetCaptcha();
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
            <div ref={widgetEl} className="flex justify-center min-h-[65px]" />
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
