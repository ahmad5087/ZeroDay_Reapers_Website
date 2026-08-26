"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Cohort 2 application form (Phase 12). Reads the `waitlist` flag: off → "registration closed" card,
// on → the full application (anon `join_waitlist_v2` RPC — migration 096). Every field is compulsory
// (college only when status = Student). Validation here mirrors the server-side rules so the UX is clean;
// the RPC re-enforces them. Branded to match the marketing site (blood-on-ink).

const DOMAINS = ["Offensive Security", "Defensive Security", "Cloud Security", "AI Security", "GRC", "Digital Forensics"];
const RAM_OPTS = ["8", "16", "24"];
const STATUS_OPTS = ["Student", "Unemployed", "Employed"];
const GENDER_OPTS = ["Male", "Female", "Trans"];
const EXPERIENCE_OPTS = ["Beginner", "Intermediate", "Advanced"];

const LINKEDIN_RE = /^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9%._-]+\/?$/;
const PHONE_RE = /^\+[0-9][0-9 ()\-]{6,18}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const BRIEFING = [
  ["Starts", "Cohort 2 begins 1st October 2026."],
  ["Format", "6-week remote internship — weekly task-based."],
  ["Prize", "The top student in each domain wins 1 month of TryHackMe Pro OR HackTheBox Pro."],
  ["Fee", "One-time registration fee of PKR 1,000, paid after Week 1."],
  ["Referrals", "The more interns you refer who join the internship, the better your chance to become an admin of the community — and to work with me directly in future."],
];

const EMPTY = {
  name: "", email: "", phone: "", country: "", city: "", linkedin_url: "",
  domain: "", ram: "", current_status: "", college: "", study_year: "", gender: "", experience: "", motivation: "",
};

export default function WaitlistForm() {
  const [on, setOn] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitErr, setSubmitErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("feature_flags").select("enabled").eq("key", "waitlist").maybeSingle();
        setOn(!!data?.enabled);
      } catch { setOn(false); }
    })();
  }, []);

  const set = (k) => (e) => {
    const v = e.target.value;
    setForm((s) => ({ ...s, [k]: v }));
    if (errors[k]) setErrors((s) => ({ ...s, [k]: undefined }));
  };

  function validate(f) {
    const er = {};
    if (!f.name.trim()) er.name = "Enter your full name.";
    if (!EMAIL_RE.test(f.email.trim())) er.email = "Enter a valid email address.";
    if (!PHONE_RE.test(f.phone.trim())) er.phone = "Include your country code, e.g. +923001234567.";
    if (!f.country.trim()) er.country = "Enter your country.";
    if (!f.city.trim()) er.city = "Enter your city.";
    if (!LINKEDIN_RE.test(f.linkedin_url.trim()))
      er.linkedin_url = "Must be a LinkedIn profile URL, e.g. https://www.linkedin.com/in/your-handle";
    if (!DOMAINS.includes(f.domain)) er.domain = "Choose a domain.";
    if (!RAM_OPTS.includes(f.ram)) er.ram = "Select your RAM.";
    if (!STATUS_OPTS.includes(f.current_status)) er.current_status = "Select your current status.";
    if (f.current_status === "Student" && !f.college.trim()) er.college = "Enter your college or university.";
    if (f.current_status === "Student" && !f.study_year.trim()) er.study_year = "Enter your semester or college year.";
    if (!GENDER_OPTS.includes(f.gender)) er.gender = "Select your gender.";
    if (!EXPERIENCE_OPTS.includes(f.experience)) er.experience = "Select your experience level.";
    if (f.motivation.trim().length < 10) er.motivation = "Tell us in at least a sentence.";
    return er;
  }

  async function submit(e) {
    e.preventDefault();
    setSubmitErr("");
    const er = validate(form);
    if (Object.keys(er).length) {
      setErrors(er);
      // Focus the first invalid field.
      const first = document.querySelector(`[data-field="${Object.keys(er)[0]}"]`);
      if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (!supabase) return setSubmitErr("Registration is temporarily unavailable — please try again shortly.");
    setBusy(true);
    const isStudent = form.current_status === "Student";
    const payload = {
      ...form,
      college: isStudent ? form.college.trim() : "",
      study_year: isStudent ? form.study_year.trim() : "",
    };
    const { error } = await supabase.rpc("join_waitlist_v2", { p: payload });
    setBusy(false);
    if (error) {
      setSubmitErr("Couldn't submit your application — please review your details and try again.");
      return;
    }
    setDone(true);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // Loading (flag unknown).
  if (on === null) return <div className="mt-10 h-2 w-24 rounded bg-blood/20 animate-pulse" aria-hidden />;

  // Registration closed.
  if (!on) {
    return (
      <div className="mt-10 border border-blood/20 bg-black/40 rounded-2xl p-6 sm:p-8">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-blood">// registration closed</div>
        <p className="mt-3 text-neutral-300 leading-relaxed">
          Cohort 2 registration isn&apos;t open just yet. We&apos;ll email everyone the moment it goes live —
          follow us so you don&apos;t miss it.
        </p>
      </div>
    );
  }

  // Success.
  if (done) {
    return (
      <div className="mt-10 border border-blood/40 bg-blood/[0.06] rounded-2xl p-6 sm:p-10 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-blood/50 bg-blood/10">
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-blood" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </div>
        <h3 className="mt-4 font-mono text-lg text-white">Application received for Cohort 2</h3>
        <p className="mt-2 text-neutral-400 text-sm leading-relaxed max-w-md mx-auto">
          Thanks — we&apos;ve saved your application. Watch your inbox: we&apos;ll send onboarding, your domain
          track, and payment details (the PKR 1,000 fee is due after Week 1) before{" "}
          <span className="text-neutral-200">1st October 2026</span>.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="mt-10 max-w-2xl">
      {/* Dark option list for native selects on this (non-portal) page. */}
      <style>{`select.wl-select option { background:#0a0b12; color:#e8eefc; }`}</style>

      {/* Cohort briefing */}
      <div className="border border-blood/25 bg-black/50 rounded-2xl p-6 sm:p-7">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-blood">// cohort 2 — briefing</div>
        <dl className="mt-4 space-y-3">
          {BRIEFING.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[92px_1fr] gap-3 items-baseline">
              <dt className="font-mono text-[11px] uppercase tracking-widest text-neutral-500">{k}</dt>
              <dd className="text-neutral-300 text-sm leading-relaxed">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-5 text-neutral-600 text-xs">All fields below are required.</p>
      </div>

      {/* Application fields */}
      <div className="mt-6 border border-blood/20 bg-black/40 rounded-2xl p-6 sm:p-8 space-y-6">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-blood">// application</div>

        <div className="grid sm:grid-cols-2 gap-5">
          <Text f="name" label="Full name" placeholder="Jane Doe" autoComplete="name" form={form} errors={errors} onChange={set} />
          <Text f="email" label="Email address" type="email" placeholder="you@example.com" autoComplete="email" form={form} errors={errors} onChange={set} />
          <Text f="phone" label="WhatsApp number (with country code)" placeholder="+923001234567" autoComplete="tel" form={form} errors={errors} onChange={set} />
          <Text f="country" label="Country" placeholder="Pakistan" autoComplete="country-name" form={form} errors={errors} onChange={set} />
          <Text f="city" label="City" placeholder="Karachi" autoComplete="address-level2" form={form} errors={errors} onChange={set} />
          <Select f="domain" label="Internship domain" options={DOMAINS} form={form} errors={errors} onChange={set} />
        </div>

        <Text
          f="linkedin_url"
          label="LinkedIn profile URL"
          placeholder="https://www.linkedin.com/in/your-handle"
          hint="Format: https://www.linkedin.com/in/your-handle (trailing slash optional)."
          form={form} errors={errors} onChange={set}
        />

        <div className="grid sm:grid-cols-3 gap-5">
          <Select f="ram" label="Your RAM (GB)" options={RAM_OPTS} form={form} errors={errors} onChange={set} />
          <Select f="gender" label="Gender" options={GENDER_OPTS} form={form} errors={errors} onChange={set} />
          <Select f="experience" label="Experience level" options={EXPERIENCE_OPTS} form={form} errors={errors} onChange={set} />
        </div>

        <div className="grid sm:grid-cols-2 gap-5">
          <Select f="current_status" label="Current status" options={STATUS_OPTS} form={form} errors={errors} onChange={set} />
          {form.current_status === "Student" && (
            <Text f="college" label="College/University" placeholder="e.g. NED University" form={form} errors={errors} onChange={set} />
          )}
        </div>

        {form.current_status === "Student" && (
          <div className="grid sm:grid-cols-2 gap-5">
            <Text f="study_year" label="Semester / College year" placeholder="e.g. 6th semester or 2nd year" form={form} errors={errors} onChange={set} />
          </div>
        )}

        <TextArea f="motivation" label="Why you? (short answer)" placeholder="A few lines on why you're a great fit for this cohort." form={form} errors={errors} onChange={set} />

        <button type="submit" disabled={busy} className="btn-neon w-full px-6 py-3.5 font-mono text-sm uppercase tracking-widest">
          {busy ? "Submitting…" : "Submit application →"}
        </button>

        {submitErr && <p className="text-blood text-sm" role="alert">{submitErr}</p>}

        <p className="text-neutral-600 text-xs leading-relaxed">
          By applying you agree to receive cohort emails from ZeroDay Reapers. We never share your details —
          see our <a href="/privacy" className="text-neutral-400 hover:text-blood transition underline underline-offset-2">privacy policy</a>.
        </p>
      </div>
    </form>
  );
}

/* ---- Field primitives (shared styling) ---- */

const LABEL = "font-mono text-[11px] uppercase tracking-[0.22em] text-neutral-500";
const FIELD =
  "w-full bg-black/40 border rounded-lg px-4 py-3 text-[15px] text-neutral-100 placeholder-neutral-600 " +
  "transition focus:outline-none focus:ring-2 focus:ring-blood/25";

function err(hasErr) {
  return `${FIELD} ${hasErr ? "border-blood focus:border-blood" : "border-blood/20 focus:border-blood"}`;
}

function Text({ f, label, type = "text", placeholder, hint, autoComplete, form, errors, onChange }) {
  return (
    <div className="space-y-2" data-field={f}>
      <label htmlFor={`wl-${f}`} className={LABEL}>{label} <span className="text-blood">*</span></label>
      <input
        id={`wl-${f}`} type={type} placeholder={placeholder} autoComplete={autoComplete}
        className={err(errors[f])} value={form[f]} onChange={onChange(f)}
        aria-invalid={!!errors[f]}
      />
      {hint && !errors[f] && <p className="text-neutral-600 text-xs">{hint}</p>}
      {errors[f] && <p className="text-blood text-xs">{errors[f]}</p>}
    </div>
  );
}

function TextArea({ f, label, placeholder, form, errors, onChange }) {
  return (
    <div className="space-y-2" data-field={f}>
      <label htmlFor={`wl-${f}`} className={LABEL}>{label} <span className="text-blood">*</span></label>
      <textarea
        id={`wl-${f}`} rows={4} placeholder={placeholder}
        className={`${err(errors[f])} resize-y`} value={form[f]} onChange={onChange(f)}
        aria-invalid={!!errors[f]}
      />
      {errors[f] && <p className="text-blood text-xs">{errors[f]}</p>}
    </div>
  );
}

function Select({ f, label, options, form, errors, onChange }) {
  return (
    <div className="space-y-2" data-field={f}>
      <label htmlFor={`wl-${f}`} className={LABEL}>{label} <span className="text-blood">*</span></label>
      <select
        id={`wl-${f}`} className={`wl-select ${err(errors[f])} ${form[f] ? "" : "text-neutral-600"}`}
        value={form[f]} onChange={onChange(f)} aria-invalid={!!errors[f]}
      >
        <option value="" disabled>Select…</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      {errors[f] && <p className="text-blood text-xs">{errors[f]}</p>}
    </div>
  );
}
