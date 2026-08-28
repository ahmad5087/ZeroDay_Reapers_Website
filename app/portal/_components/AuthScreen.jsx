"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authErrorMessage, withAuthTimeout } from "@/lib/auth-timeout";
import PasswordInput from "./PasswordInput";
import { classroomLinkFor, DISCORD_INVITE } from "@/lib/classroom";
import { COUNTRIES, dialFor } from "@/lib/countries";
import Flag from "@/app/_components/Flag";

// Cloudflare Turnstile (public site key; safe to ship). Override per-env if needed.
const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAD-uyq_gi8HfhgxA";

// Discord auto-join is "on" only when a public client id is present. Until then, signup
// falls back to honor-mode (invite link + checkbox) so the live portal never breaks.
const DISCORD_ENABLED = Boolean(process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID);

// Password policy: 12+ chars with upper, lower, number, and symbol.
const PW_CHECKS = [
  { label: "At least 12 characters", test: (p) => p.length >= 12 },
  { label: "An uppercase letter (A–Z)", test: (p) => /[A-Z]/.test(p) },
  { label: "A lowercase letter (a–z)", test: (p) => /[a-z]/.test(p) },
  { label: "A number (0–9)", test: (p) => /[0-9]/.test(p) },
  { label: "A symbol (!@#$…)", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const STRENGTH_LABELS = ["Too weak", "Weak", "Fair", "Good", "Strong", "Excellent"];
const STRENGTH_COLORS = ["#7f1d1d", "#b91c1c", "#f59e0b", "#eab308", "#34d399", "#22d3ee"];
const pwStrength = (p) => PW_CHECKS.filter((c) => c.test(p)).length; // 0..5

export default function AuthScreen() {
  const [tab, setTab] = useState("login"); // 'login' | 'signup'
  const [signupsOpen, setSignupsOpen] = useState(true); // false → the Sign up tab shows a "closed" message
  const [domains, setDomains] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [mfa, setMfa] = useState(null); // { factorId } when a TOTP challenge is required
  const [otp, setOtp] = useState("");

  const [form, setForm] = useState({
    fullName: "", displayName: "", email: "", password: "", confirm: "", domainId: "", gender: "", ram: "", country: "", phone: "",
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Signup join-gate state.
  const [classroomConfirmed, setClassroomConfirmed] = useState(false);
  const [discordHonor, setDiscordHonor] = useState(false);   // honor-mode checkbox (Discord OAuth off)
  const [discord, setDiscord] = useState(null);              // { id, username } after OAuth auto-join
  const [discordBusy, setDiscordBusy] = useState(false);
  const [discordErr, setDiscordErr] = useState("");

  // Changing department/RAM invalidates a prior Classroom confirmation (it was a different classroom).
  const setDomainId = (e) => { const v = e.target.value; setForm((f) => ({ ...f, domainId: v })); setClassroomConfirmed(false); };
  const setRam = (e) => { const v = e.target.value; setForm((f) => ({ ...f, ram: v })); setClassroomConfirmed(false); };

  // Turnstile captcha: single-use token, reset after each auth attempt.
  const [captcha, setCaptcha] = useState("");
  const widgetEl = useRef(null);
  const widgetId = useRef(null);

  useEffect(() => {
    // domains are readable pre-auth (anon select policy)
    supabase.from("domains").select("id,key,name,sort").not("key", "in", "(lobby,alumni)")
      .order("sort").then(({ data }) => setDomains(data || []));
    // signups_open() is an anon-callable SECURITY DEFINER helper (app_settings itself is auth-only).
    supabase.rpc("signups_open").then(({ data }) => setSignupsOpen(data !== false), () => {});
  }, []);

  // Receive the Discord OAuth popup result (same-origin postMessage).
  useEffect(() => {
    function onMsg(e) {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (!d || d.type !== "zdr-discord-auth") return;
      setDiscordBusy(false);
      if (d.ok) { setDiscord({ id: d.id, username: d.username }); setDiscordErr(""); }
      else { setDiscordErr(d.error || "Discord verification failed. Please try again."); }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
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

  function connectDiscord() {
    setDiscordErr("");
    setDiscordBusy(true);
    const w = 500, h = 800;
    const left = window.screenX + Math.max(0, (window.outerWidth - w) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - h) / 2);
    const popup = window.open("/api/discord/start", "zdr-discord", `width=${w},height=${h},left=${left},top=${top}`);
    if (!popup) { setDiscordBusy(false); setDiscordErr("Popup blocked — allow popups for this site and retry."); return; }
    // Clear the busy state if the user closes the popup without finishing.
    const timer = setInterval(() => {
      if (popup.closed) { clearInterval(timer); setDiscordBusy((b) => (discord ? b : false)); }
    }, 700);
  }

  async function onLogin(e) {
    e.preventDefault();
    setErr(""); setNotice("");
    if (!captcha) return setErr("Please complete the captcha.");
    setBusy(true);
    try {
      const { error } = await withAuthTimeout(supabase.auth.signInWithPassword({
        email: form.email.trim(), password: form.password,
        options: { captchaToken: captcha },
      }));
      if (error) throw error;

      // If this account has 2FA enabled, require a TOTP challenge to reach aal2.
      const { data: aal, error: aalError } = await withAuthTimeout(
        supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      );
      if (aalError) throw aalError;
      if (aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2") {
        const { data: f, error: factorError } = await withAuthTimeout(supabase.auth.mfa.listFactors());
        if (factorError) throw factorError;
        const factor = (f?.totp || [])[0];
        if (factor) return setMfa({ factorId: factor.id });
      }
    } catch (error) {
      setErr(authErrorMessage(error, "Sign-in"));
    } finally {
      resetCaptcha();
      setBusy(false);
    }
  }

  async function onVerifyMfa(e) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const { error } = await withAuthTimeout(
        supabase.auth.mfa.challengeAndVerify({ factorId: mfa.factorId, code: otp.trim() })
      );
      if (error) throw error;
      setMfa(null); setOtp("");
      // session is now aal2 — the portal page's auth listener takes over
    } catch (error) {
      setErr(authErrorMessage(error, "Two-factor verification"));
    } finally {
      setBusy(false);
    }
  }

  async function onSignup(e) {
    e.preventDefault();
    setErr(""); setNotice("");
    if (!form.fullName.trim()) return setErr("Please enter your full name (as it should appear on your certificate).");
    if (!form.email.trim()) return setErr("Please enter your email.");
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return setErr("Please enter a valid email address.");
    const failed = PW_CHECKS.filter((c) => !c.test(form.password));
    if (failed.length) return setErr("Password must have: " + failed.map((f) => f.label.toLowerCase()).join(", ") + ".");
    if (form.password !== form.confirm) return setErr("Passwords do not match.");
    if (!form.gender) return setErr("Please select your gender.");
    if (!form.country) return setErr("Please select your country.");
    if (!form.phone.trim()) return setErr("Please enter your phone number.");
    if (!form.ram) return setErr("Please select your system RAM.");
    if (!form.domainId) return setErr("Please choose your domain.");
    if (!classroomLink) return setErr("No Classroom link for this Department + RAM — please contact an admin.");
    if (!classroomConfirmed) return setErr("Please join your Google Classroom, then tick the confirmation.");
    if (DISCORD_ENABLED) {
      if (!discord) return setErr("Please connect your Discord to continue.");
    } else if (!discordHonor) {
      return setErr("Please join our Discord server, then tick the confirmation.");
    }
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
          country: form.country,
          dial_code: dialFor(form.country),
          phone: form.phone.trim(),
          classroom_confirmed: "true",
          discord_id: discord?.id || "",
          discord_username: discord?.username || "",
        },
      },
    });
    setBusy(false);
    resetCaptcha();
    if (error) return setErr(error.message);
    // Supabase hides "email already registered" behind an obfuscated user (empty identities array)
    // rather than an error. Detect it so a returning email isn't told to "check your email" for a
    // confirmation link that never arrives (their profile already exists) — send them to log in.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      setTab("login");
      return setErr("That email is already registered. Log in below, or use “Forgot password” if you can’t get in.");
    }
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
    // Magic link is SIGN-IN ONLY. Without shouldCreateUser:false, Supabase silently creates a
    // brand-new account with an empty raw_user_meta_data, so the profile trigger writes a row with
    // only the email (no name/gender/RAM/domain/country/phone). That bare account then swallows the
    // person's later real signup (same email = "already registered", metadata never applied). New
    // members must go through the Sign up tab so their form data is carried into the profile.
    const { error } = await supabase.auth.signInWithOtp({
      email: form.email.trim(),
      options: {
        captchaToken: captcha,
        shouldCreateUser: false,
        emailRedirectTo: typeof window !== "undefined" ? window.location.origin + "/portal" : undefined,
      },
    });
    setBusy(false);
    resetCaptcha();
    if (error) {
      // GoTrue returns code "otp_disabled" / "Signups not allowed for otp" when no account exists.
      const noAccount = error.code === "otp_disabled" || /not allowed|otp[_ ]disabled/i.test(error.message || "");
      return setErr(noAccount
        ? "No account found for that email. Please use the Sign up tab to register first."
        : error.message);
    }
    setNotice("Magic link sent — check your email to sign in.");
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

  const input = "input-neon px-4 py-3 text-sm";

  // ---- signup derived state (join gate + strength) ----
  const strength = pwStrength(form.password);
  const selectedDomain = domains.find((d) => String(d.id) === String(form.domainId));
  const classroomLink = form.ram && selectedDomain ? classroomLinkFor(selectedDomain.key, form.ram) : null;
  const pwRulesOk = form.password.length > 0 && PW_CHECKS.every((c) => c.test(form.password));
  const pwMatch = form.password.length > 0 && form.password === form.confirm;
  const discordOk = DISCORD_ENABLED ? !!discord : discordHonor;
  // Every field is compulsory except Display name. The button stays clickable and
  // onSignup reports the first missing one; this list mirrors those checks (in the same
  // top-to-bottom order) so interns see everything still outstanding at a glance.
  const signupGates = [
    { label: "Full name", ok: !!form.fullName.trim() },
    { label: "Email", ok: !!form.email.trim() },
    { label: "Password meets all requirements", ok: pwRulesOk },
    { label: "Both password fields match", ok: pwMatch },
    { label: "Gender", ok: !!form.gender },
    { label: "Country", ok: !!form.country },
    { label: "Phone number", ok: !!form.phone.trim() },
    { label: "System RAM", ok: !!form.ram },
    { label: "Domain", ok: !!form.domainId },
    { label: "Joined the Google Classroom (ticked)", ok: classroomConfirmed },
    { label: DISCORD_ENABLED ? "Discord connected" : "Joined the Discord server (ticked)", ok: discordOk },
  ];
  const signupMissing = signupGates.filter((g) => !g.ok);
  const signupReady = signupMissing.length === 0;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="relative">
            <div className="absolute inset-0 blur-2xl bg-blood/40 rounded-full animate-glow-pulse" />
            <img src="/logo.svg" alt="" width={56} height={56} className="relative h-14 w-14 animate-float-slow" />
          </div>
          <h1 className="font-mono text-lg tracking-[0.3em] font-bold">
            <span className="grad-text">ZERODAY</span> <span className="neon-red">REAPERS</span>
          </h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.4em] text-neutral-500">Intern Portal · Secure Access</p>
        </div>

        <div className="glass glass-red cyber-corners p-8">
          <div className="flex gap-2 mb-6 p-1 rounded-xl bg-black/40 font-mono text-xs uppercase tracking-widest">
            {["login", "signup"].map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setErr(""); setNotice(""); }}
                className={`flex-1 py-2.5 rounded-lg transition-all ${
                  tab === t ? "btn-neon" : "text-neutral-400 hover:text-white"
                }`}
              >
                {t === "login" ? "Log in" : "Sign up"}
              </button>
            ))}
          </div>

          {err && <p className="mb-4 text-sm text-blood font-mono border border-blood/30 bg-blood/10 rounded-lg px-3 py-2">⚠ {err}</p>}
          {notice && <p className="mb-4 text-sm text-[#34d399] font-mono border border-[#34d399]/30 bg-[#34d399]/10 rounded-lg px-3 py-2">✓ {notice}</p>}

          {tab === "login" ? (
            mfa ? (
              <form onSubmit={onVerifyMfa} className="space-y-4 font-mono text-sm">
                <p className="text-neutral-500 text-xs uppercase tracking-widest">Two-factor code</p>
                <input className={input} inputMode="numeric" placeholder="6-digit code from your app" required value={otp} onChange={(e) => setOtp(e.target.value)} />
                <button disabled={busy} className="btn-neon w-full uppercase tracking-widest py-3 text-sm font-mono">
                  {busy ? "…" : "Verify →"}
                </button>
                <button type="button" onClick={() => { setMfa(null); setOtp(""); setErr(""); supabase.auth.signOut(); }} className="text-xs text-neutral-500 hover:text-blood">
                  Cancel
                </button>
              </form>
            ) : (
            <form onSubmit={onLogin} className="space-y-4 font-mono text-sm">
              <input className={input} type="email" placeholder="Email" required value={form.email} onChange={set("email")} />
              <PasswordInput className={input} placeholder="Password" required value={form.password} onChange={set("password")} autoComplete="current-password" />
              <button disabled={busy} className="btn-neon w-full uppercase tracking-widest py-3 text-sm font-mono">
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
            )
          ) : !signupsOpen ? (
            <div className="text-center py-6 font-mono text-sm">
              <div className="text-blood text-3xl mb-3">🔒</div>
              <p className="text-white mb-2 uppercase tracking-widest text-xs">Registration is closed</p>
              <p className="text-neutral-500 text-xs leading-relaxed max-w-xs mx-auto">
                New intern signups aren&apos;t open right now. If you&apos;ve been accepted into a cohort, watch
                your inbox for onboarding — or reach out if you think this is a mistake.
              </p>
            </div>
          ) : (
            <form onSubmit={onSignup} noValidate className="space-y-4 font-mono text-sm">
              <div>
                <input className={input + " w-full"} placeholder="Full name *" required value={form.fullName} onChange={set("fullName")} />
                <p className="mt-1 text-[11px] text-amber-400/90 leading-relaxed">
                  Enter your name <span className="font-semibold">exactly</span> as it should appear — it is
                  printed on your <span className="font-semibold">Offer Letter and Certificate</span>.
                </p>
              </div>
              <input className={input} placeholder="Display name — optional (handle shown in chat)" value={form.displayName} onChange={set("displayName")} />
              <input className={input} type="email" placeholder="Email" required value={form.email} onChange={set("email")} />
              <PasswordInput className={input} placeholder="Password (min 12)" required value={form.password} onChange={set("password")} autoComplete="new-password" />

              {/* Strength meter + requirements (shown upfront) */}
              <div className="space-y-2">
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-1 flex-1 rounded-sm" style={{ background: i < strength ? STRENGTH_COLORS[strength] : "#27272a" }} />
                  ))}
                </div>
                <p className="text-[11px]" style={{ color: STRENGTH_COLORS[strength] }}>
                  Password strength: {STRENGTH_LABELS[strength]}
                </p>
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
              </div>

              <PasswordInput className={input} placeholder="Confirm password" required value={form.confirm} onChange={set("confirm")} autoComplete="new-password" />
              {form.confirm && form.password !== form.confirm && (
                <p className="text-xs text-blood">Passwords do not match.</p>
              )}
              <select className={input} required value={form.gender} onChange={set("gender")}>
                <option value="">Select gender…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
              <select className={input} required value={form.country} onChange={set("country")}>
                <option value="">Select country… (sets your dialing code)</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name} ({c.dial})</option>
                ))}
              </select>
              <div className="flex items-stretch gap-2">
                <span className="flex items-center px-3 rounded-sm border border-blood/30 panel text-neutral-300 font-mono text-sm whitespace-nowrap">
                  {form.country ? <><Flag code={form.country} className="mr-1.5" />{dialFor(form.country)}</> : "＋ __"}
                </span>
                <input
                  className={input + " flex-1"}
                  type="tel"
                  required
                  placeholder={form.country ? "Phone number" : "Select country first"}
                  value={form.phone}
                  onChange={set("phone")}
                  disabled={!form.country}
                  inputMode="tel"
                  autoComplete="tel-national"
                />
              </div>
              <select className={input} required value={form.ram} onChange={setRam}>
                <option value="">Select system RAM…</option>
                <option value="8GB">8GB RAM</option>
                <option value="16GB">16GB RAM</option>
                <option value="24GB">24GB RAM</option>
              </select>
              <select className={input} required value={form.domainId} onChange={setDomainId}>
                <option value="">Choose your domain…</option>
                {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <p className="text-xs text-neutral-500 leading-relaxed">
                You can only join one domain. Only an admin can move you later.
              </p>

              {/* Join gate — appears once Department + RAM are chosen */}
              {form.domainId && form.ram && (
                <div className="border border-blood/20 rounded-sm p-4 space-y-4 bg-ink-900/40">
                  <p className="text-[11px] uppercase tracking-widest text-neutral-400">Required to finish signup</p>

                  {/* Step 1 — Google Classroom (link by Department + RAM) */}
                  <div className="space-y-2">
                    {classroomLink ? (
                      <>
                        <a href={classroomLink} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-xs text-[#34d399] hover:underline break-words">
                          ↗ Open your {selectedDomain?.name} · {form.ram} Google Classroom
                        </a>
                        <p className="text-[11px] text-amber-400/90 leading-relaxed">
                          ⚠ Join with a <span className="font-semibold">personal Google (Gmail)</span> account —
                          school/work accounts are often blocked and show <span className="italic">“Wrong account.”</span>
                        </p>
                        <label className="flex items-start gap-2 text-xs text-neutral-300 cursor-pointer">
                          <input type="checkbox" checked={classroomConfirmed} onChange={(e) => setClassroomConfirmed(e.target.checked)} className="mt-0.5 accent-blood" />
                          <span>I&apos;ve joined the Google Classroom above.</span>
                        </label>
                      </>
                    ) : (
                      <p className="text-xs text-amber-400">No Classroom link found for this Department + RAM. Please contact an admin.</p>
                    )}
                  </div>

                  {/* Step 2 — Discord (real auto-join when configured, else honor-mode) */}
                  <div className="space-y-2 border-t border-neutral-800 pt-3">
                    {DISCORD_ENABLED ? (
                      discord ? (
                        <p className="text-xs text-[#34d399]">✓ Discord connected as <b>{discord.username}</b> — you&apos;ve been added to the server.</p>
                      ) : (
                        <>
                          <button type="button" onClick={connectDiscord} disabled={discordBusy}
                            className="inline-flex items-center gap-2 bg-[#5865F2] text-white text-xs px-4 py-2 rounded-sm hover:opacity-90 transition disabled:opacity-50">
                            {discordBusy ? "Connecting…" : "Connect Discord →"}
                          </button>
                          {discordErr && <p className="text-xs text-blood">{discordErr}</p>}
                        </>
                      )
                    ) : (
                      <>
                        <a href={DISCORD_INVITE} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-xs text-[#8b93f8] hover:underline">
                          ↗ Join our Discord server
                        </a>
                        <label className="flex items-start gap-2 text-xs text-neutral-300 cursor-pointer">
                          <input type="checkbox" checked={discordHonor} onChange={(e) => setDiscordHonor(e.target.checked)} className="mt-0.5 accent-blood" />
                          <span>I&apos;ve joined the Discord server.</span>
                        </label>
                      </>
                    )}
                  </div>
                </div>
              )}

              {!signupReady && (
                <div className="border border-amber-500/20 rounded-sm p-3 space-y-1 bg-amber-500/5">
                  <p className="text-[11px] uppercase tracking-widest text-amber-400/90">Still needed to create your account</p>
                  <ul className="text-xs space-y-1">
                    {signupMissing.map((g) => (
                      <li key={g.label} className="text-neutral-400">○ {g.label}</li>
                    ))}
                  </ul>
                </div>
              )}

              <button disabled={busy} className="btn-neon w-full uppercase tracking-widest py-3 text-sm font-mono">
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
