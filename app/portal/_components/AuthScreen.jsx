"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

// Cloudflare Turnstile (public site key; safe to ship). Override per-env if needed.
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAD-uyq_gi8HfhgxA";

// Password policy: 12+ chars with upper, lower, number, and symbol.
const PW_CHECKS = [
  { label: "At least 12 characters", test: (p) => p.length >= 12 },
  { label: "An uppercase letter (A–Z)", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter (a–z)", test: (p) => /[a-z]/.test(p) },
  { label: "A number (0–9)", test: (p) => /[0-9]/.test(p) },
  { label: "A symbol (!@#$…)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export default function AuthScreen() {
  const [tab, setTab] = useState("login"); // 'login' | 'signup'
  const [domains, setDomains] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({
    fullName: "", displayName: "", email: "", password: "", confirm: "", domainId: "", gender: "", ram: "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Turnstile captcha: single-use token, reset after each auth attempt.
  const [captcha, setCaptcha] = useState("");
  const widgetEl = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    // domains are readable pre-auth (anon select policy)
    supabase.from("domains").select("id,key,name,sort").not("key", "in", "(lobby,alumni)")
      .order("sort").then(({ data }) => setDomains(data || []));
  }, []);

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
    setErr(""); setNotice("");
    if (!captcha) return setErr("Please complete the captcha.");
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: form.email.trim(), password: form.password,
      options: { captchaToken: captcha },
    });
    setBusy(false);
    resetCaptcha();
    if (error) setErr(error.message);
  }

  async function onSignup(e) {
    e.preventDefault();
    setErr(""); setNotice("");
    if (!form.gender) return setErr("Please select your gender.");
    if (!form.ram) return setErr("Please select your system RAM.");
    if (!form.domainId) return setErr("Please choose your domain.");
    const failed = PW_CHECKS.filter((c) => !c.test(form.password));
    if (failed.length) return setErr("Password must have: " + failed.map((f) => f.label.toLowerCase()).join(", ") + ".");
    if (form.password !== form.confirm) return setErr("Passwords do not match.");
    if (!captcha) return setErr("Please complete the captcha.");
    setBusy(true);
    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim(),
      password: form.password,
      options: {
        captchaToken: captcha,
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin + "/portal" : undefined,
        data: {
          display_name: form.displayName.trim(),
          full_name: form.fullName.trim(),
          domain_id: String(form.domainId),
          gender: form.gender,
          ram: form.ram,
        },
      },
    });
    setBusy(false);
    resetCaptcha();
    if (error) return setErr(error.message);
    // If email confirmation is ON, there's no active session yet.
    if (!data.session) {
      setNotice("Account created. Check your email to confirm, then log in.");
      setTab("login");
    }
  }

  async function onMagicLink() {
    if (!form.email.trim()) return setErr("Enter your email first, then request a magic link.");
    if (!captcha) return setErr("Please complete the captcha.");
    setErr(""); setNotice(""); setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: form.email.trim(),
      options: {
        captchaToken: captcha,
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin + "/portal" : undefined,
      },
    });
    setBusy(false);
    resetCaptcha();
    error ? setErr(error.message) : setNotice("Magic link sent — check your email to sign in.");
  }

  async function onForgot() {
    if (!form.email.trim()) return setErr("Enter your email first, then click Forgot password.");
    if (!captcha) return setErr("Please complete the captcha.");
    setErr(""); setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(form.email.trim(), {
      captchaToken: captcha,
      redirectTo: typeof window !== "undefined" ? window.location.origin + "/portal" : undefined,
    });
    setBusy(false);
    resetCaptcha();
    error ? setErr(error.message) : setNotice("Password reset link sent to your email.");
  }

  const input =
    "w-full bg-ink-900 border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-8">
          <img src="/logo.svg" alt="" width={40} height={40} className="h-10 w-10 animate-glow-pulse" />
          <span className="font-mono text-sm tracking-widest text-white text-glow">
            ZERO<span className="text-blood">DAY</span> REAPERS
          </span>
        </div>

        <div className="border border-blood/20 bg-black/40 backdrop-blur rounded-sm p-8">
          <div className="flex gap-2 mb-6 font-mono text-xs uppercase tracking-widest">
            {["login", "signup"].map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setErr(""); setNotice(""); }}
                className={`flex-1 py-2 rounded-sm transition ${
                  tab === t ? "bg-blood text-ink-950" : "border border-neutral-700 text-neutral-400 hover:text-blood hover:border-blood"
                }`}
              >
                {t === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          {err && <p className="mb-4 text-sm text-blood font-mono">{err}</p>}
          {notice && <p className="mb-4 text-sm text-[#34d399] font-mono">{notice}</p>}

          {tab === "login" ? (
            <form onSubmit={onLogin} className="space-y-4 font-mono text-sm">
              <input className={input} type="email" placeholder="Email" required value={form.email} onChange={set("email")} />
              <input className={input} type="password" placeholder="Password" required value={form.password} onChange={set("password")} />
              <button disabled={busy} className="w-full bg-blood text-ink-950 uppercase tracking-widest py-3 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
                {busy ? "…" : "Log in →"}
              </button>
              <div className="flex justify-between text-xs">
                <button type="button" onClick={onForgot} className="text-neutral-500 hover:text-blood">
                  Forgot password?
                </button>
                <button type="button" onClick={onMagicLink} className="text-neutral-500 hover:text-blood">
                  Email me a magic link
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={onSignup} className="space-y-4 font-mono text-sm">
              <input className={input} placeholder="Full name" required value={form.fullName} onChange={set("fullName")} />
              <input className={input} placeholder="Display name (shown in chat)" required value={form.displayName} onChange={set("displayName")} />
              <input className={input} type="email" placeholder="Email" required value={form.email} onChange={set("email")} />
              <input className={input} type="password" placeholder="Password (min 12)" required value={form.password} onChange={set("password")} />
              {form.password && (
                <ul className="text-xs space-y-1">
                  {PW_CHECKS.map((c) => {
                    const ok = c.test(form.password);
                    return (
                      <li key={c.label} className={ok ? "text-[#34d399]" : "text-neutral-500"}>
                        {ok ? "✓" : "○"} {c.label}
                      </li>
                    );
                  })}
                </ul>
              )}
              <input className={input} type="password" placeholder="Confirm password" required value={form.confirm} onChange={set("confirm")} />
              {form.confirm && form.password !== form.confirm && (
                <p className="text-xs text-blood">Passwords do not match.</p>
              )}
              <select className={input} required value={form.gender} onChange={set("gender")}>
                <option value="">Select gender…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
              <select className={input} required value={form.ram} onChange={set("ram")}>
                <option value="">Select system RAM…</option>
                <option value="8GB">8GB RAM</option>
                <option value="16GB">16GB RAM</option>
                <option value="24GB">24GB RAM</option>
              </select>
              <select className={input} required value={form.domainId} onChange={set("domainId")}>
                <option value="">Choose your domain…</option>
                {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <p className="text-xs text-neutral-500 leading-relaxed">
                You can only join one domain. Only an admin can move you later.
              </p>
              <button disabled={busy} className="w-full bg-blood text-ink-950 uppercase tracking-widest py-3 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
                {busy ? "…" : "Create account →"}
              </button>
            </form>
          )}

          <div ref={widgetEl} className="mt-5 flex justify-center min-h-[65px]" />
        </div>

        <a href="/" className="block text-center mt-6 font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-blood">
          ← Back to site
        </a>
      </div>
    </div>
  );
}
