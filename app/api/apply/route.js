import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendCohortApplicationToDiscord } from "@/lib/discord";

export const runtime = "nodejs";

// Cohort 2 application intake (Phase 12). The public form POSTs here instead of calling Supabase directly,
// so (a) the Discord webhook URL stays server-side and (b) every rule is re-validated on the server. Flow:
// validate → respect the `waitlist` flag → insert via anon RPC join_waitlist_v2 (migration 096) → best-
// effort Discord embed. Uses the anon key (the RPC is security-definer + anon-granted); no service role.

const DOMAINS = ["Offensive Security", "Defensive Security", "Cloud Security", "AI Security", "GRC", "Digital Forensics"];
const RAM = [8, 16, 24];
const STATUS = ["Student", "Unemployed", "Employed"];
const GENDER = ["Male", "Female", "Trans"];
const EXPERIENCE = ["Beginner", "Intermediate", "Advanced"];
const LINKEDIN_RE = /^https:\/\/www\.linkedin\.com\/in\/[A-Za-z0-9%._-]+\/?$/;
const PHONE_RE = /^\+[0-9][0-9 ()\-]{6,18}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const isStudent = String(b.current_status || "").trim() === "Student";
  const app = {
    name: String(b.name || "").trim(),
    email: String(b.email || "").trim().toLowerCase(),
    phone: String(b.phone || "").trim(),
    country: String(b.country || "").trim(),
    city: String(b.city || "").trim(),
    linkedin_url: String(b.linkedin_url || "").trim(),
    domain: String(b.domain || "").trim(),
    ram: String(b.ram || "").trim(),
    current_status: String(b.current_status || "").trim(),
    college: isStudent ? String(b.college || "").trim() : "",
    study_year: isStudent ? String(b.study_year || "").trim() : "",
    gender: String(b.gender || "").trim(),
    experience: String(b.experience || "").trim(),
    motivation: String(b.motivation || "").trim(),
    referral_code: String(b.referral_code || "").trim(),
  };

  // Server-side validation — mirrors the client and the RPC.
  const valid =
    app.name &&
    EMAIL_RE.test(app.email) &&
    PHONE_RE.test(app.phone) &&
    app.country &&
    app.city &&
    LINKEDIN_RE.test(app.linkedin_url) &&
    DOMAINS.includes(app.domain) &&
    RAM.includes(Number(app.ram)) &&
    STATUS.includes(app.current_status) &&
    GENDER.includes(app.gender) &&
    EXPERIENCE.includes(app.experience) &&
    app.motivation.length >= 10 &&
    (!isStudent || (app.college && app.study_year));
  if (!valid) return NextResponse.json({ error: "invalid" }, { status: 400 });

  const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

  // Only accept submissions while registration is open (the form is flag-gated in the UI too).
  // is_feature_enabled is a SECURITY DEFINER helper (anon-callable); the feature_flags table itself is only
  // readable by `authenticated`, so a direct anon-key read here would always come back empty.
  const { data: waitlistOpen } = await sb.rpc("is_feature_enabled", { p_key: "waitlist" });
  if (!waitlistOpen) return NextResponse.json({ error: "closed" }, { status: 403 });

  const { error } = await sb.rpc("join_waitlist_v2", { p: app });
  if (error) {
    // The RPC rejects an unknown referral code — surface that so the form can flag the field.
    if (String(error.message || "").includes("invalid_referral")) {
      return NextResponse.json({ error: "invalid_referral" }, { status: 400 });
    }
    return NextResponse.json({ error: "insert_failed" }, { status: 502 });
  }

  // Best-effort Discord embed to #cohort-2-registration (no-op if the webhook env var is unset).
  sendCohortApplicationToDiscord(app).catch(() => {});

  return NextResponse.json({ ok: true });
}
