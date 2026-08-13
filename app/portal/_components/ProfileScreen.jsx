"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { uploadToR2, downloadFromR2 } from "@/lib/r2client";
import PasswordInput from "./PasswordInput";
import { emailSelf } from "@/lib/notify";
import { COUNTRIES, dialFor, countryNameFor } from "@/lib/countries";
import Flag from "@/app/_components/Flag";
import { classroomLinkFor } from "@/lib/classroom";
import { SubmissionFeedbackCard, attemptLabelFor, groupAttemptsByWeek, mergeSubmissionAttempts } from "./SubmissionFeedback";

// Same strength policy as signup (also enforce it server-side in Supabase).
const PW_RULES = [
  { label: "12+ characters", test: (p) => p.length >= 12 },
  { label: "an uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "a lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "a number", test: (p) => /[0-9]/.test(p) },
  { label: "a symbol", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

// Human labels for portal-issue categories (shared shape with AdminPanel).
const ISSUE_LABELS = { bug: "Bug", ui: "Display", access: "Access", account: "Account", other: "Other" };

// Turn a raw user-agent string into a readable "Browser on OS · Kind" fingerprint for the devices list.
function describeDevice(ua = "") {
  if (!ua) return "Unknown device";
  let os = "Unknown OS";
  if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT 6\.3/.test(ua)) os = "Windows 8.1";
  else if (/Windows NT 6\.1/.test(ua)) os = "Windows 7";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/iPad/.test(ua)) os = "iPadOS";
  else if (/iPhone|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) { const m = ua.match(/Android ([\d.]+)/); os = m ? `Android ${m[1]}` : "Android"; }
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let browser = "browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
  else if (/SamsungBrowser/.test(ua)) browser = "Samsung Internet";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/CriOS\//.test(ua)) browser = "Chrome";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";

  const kind = /iPad|Tablet/.test(ua) ? "Tablet" : /Mobile|iPhone|iPod|Android/.test(ua) ? "Phone" : "Desktop";
  return `${browser} on ${os} · ${kind}`;
}

// Common Android model codes → marketing names (best-effort; Pixel/OnePlus usually report a name already).
// iPhones and laptops never expose a model, so those simply fall back to the OS+browser label.
const ANDROID_MODELS = {
  "SM-G970": "Galaxy S10e", "SM-G973": "Galaxy S10", "SM-G975": "Galaxy S10+",
  "SM-G980": "Galaxy S20", "SM-G985": "Galaxy S20+", "SM-G988": "Galaxy S20 Ultra",
  "SM-G991": "Galaxy S21", "SM-G996": "Galaxy S21+", "SM-G998": "Galaxy S21 Ultra",
  "SM-S901": "Galaxy S22", "SM-S906": "Galaxy S22+", "SM-S908": "Galaxy S22 Ultra",
  "SM-S911": "Galaxy S23", "SM-S916": "Galaxy S23+", "SM-S918": "Galaxy S23 Ultra",
  "SM-S921": "Galaxy S24", "SM-S926": "Galaxy S24+", "SM-S928": "Galaxy S24 Ultra",
  "SM-N970": "Galaxy Note 10", "SM-N975": "Galaxy Note 10+", "SM-N986": "Galaxy Note 20 Ultra",
  "SM-A515": "Galaxy A51", "SM-A525": "Galaxy A52", "SM-A536": "Galaxy A53", "SM-A546": "Galaxy A54",
};
function friendlyModel(model = "") {
  if (!model) return "";
  for (const [code, name] of Object.entries(ANDROID_MODELS)) if (model.startsWith(code)) return name;
  return model; // already-friendly names pass through; unknown codes show as-is
}
function deviceLabel(d) {
  const base = describeDevice(d.user_agent);
  const model = friendlyModel(d.device_model);
  return model ? `${model} · ${base}` : base;
}

export function ProfileScreen({ me, setMe, onBack }) {
  const [displayName, setDisplayName] = useState(me?.display_name || "");
  const [fullName, setFullName] = useState(me?.full_name || "");
  const [gender, setGender] = useState(me?.gender || ""); // admins can edit their own
  const [phone, setPhone] = useState(me?.phone || "");     // editable; country stays fixed
  const [country, setCountry] = useState(me?.country || ""); // admins/founders can change their own
  const [linkedin, setLinkedin] = useState(me?.linkedin_url || ""); // LinkedIn profile / company page
  const [github, setGithub] = useState(me?.github_url || ""); // GitHub profile / org
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [pw, setPw] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwStep, setPwStep] = useState(false); // 2FA step-up (AAL2) needed to change password
  const [pwOtp, setPwOtp] = useState("");
  const [offerBusy, setOfferBusy] = useState(false);
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  // Report-a-portal-issue box (permanent; visible to everyone).
  const [issueBody, setIssueBody] = useState("");
  const [issueCategory, setIssueCategory] = useState("bug");
  const [issueBusy, setIssueBusy] = useState(false);
  const [myIssues, setMyIssues] = useState([]);
  const [feedbackHistory, setFeedbackHistory] = useState([]);
  const [feedbackLoading, setFeedbackLoading] = useState(me?.role !== "admin");
  const [feedbackError, setFeedbackError] = useState("");

  async function handleSaveDetails(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    if (!fullName.trim()) return setErr("Full name is required (it appears on your Offer Letter & Certificate).");

    const updates = {
      // Display name is optional; fall back to the full name as the chat handle when left blank.
      display_name: displayName.trim() || fullName.trim(),
      full_name: fullName.trim(),
      phone: phone.trim() || null,
    };
    // Admins may set/change their own gender (students can't after signup).
    if (isAdmin && gender) updates.gender = gender;
    // Admins/founders may change their own country (interns cannot).
    if (isAdmin) { updates.country = country || null; updates.dial_code = country ? dialFor(country) : null; }

    // LinkedIn (optional): only a personal profile (…/in/) or company page (…/company/) is kept.
    // Any other link is discarded automatically. Light normalization fills in a missing scheme /
    // www so a pasted or lightly-typed link still lands in the exact accepted format.
    const dropped = [];
    let li = linkedin.trim();
    if (li) {
      if (!/^https?:\/\//i.test(li)) li = "https://" + li;
      li = li
        .replace(/^http:\/\//i, "https://")
        .replace(/^https:\/\/linkedin\.com/i, "https://www.linkedin.com");
      if (!/^https:\/\/www\.linkedin\.com\/(in|company)\/[^\/]/i.test(li)) { li = ""; dropped.push("LinkedIn"); }
    }
    updates.linkedin_url = li || null;

    // GitHub (optional): only a github.com profile/org link is kept; anything else is discarded.
    let gh = github.trim();
    if (gh) {
      if (!/^https?:\/\//i.test(gh)) gh = "https://" + gh;
      gh = gh
        .replace(/^http:\/\//i, "https://")
        .replace(/^https:\/\/www\.github\.com/i, "https://github.com");
      if (!/^https:\/\/github\.com\/[^\/]/i.test(gh)) { gh = ""; dropped.push("GitHub"); }
    }
    updates.github_url = gh || null;

    const { error } = await supabase.from("profiles").update(updates).eq("id", me.id);
    if (error) return setErr(error.message);

    setMe((m) => ({ ...m, ...updates }));
    // Reflect what was actually saved: normalized links, and any discarded ones cleared.
    setLinkedin(li);
    setGithub(gh);
    if (dropped.length) {
      setOk(`Profile updated. Your ${dropped.join(" and ")} link wasn't in an accepted format, so it wasn't saved.`);
    } else {
      setOk("Profile updated successfully!");
    }
  }

  // Build the letter's full HTML doc from this profile. Returns { html, offerId } or null (missing name).
  async function buildOfferLetter() {
    const fullName = (me.full_name || "").trim();
    if (!fullName) {
      setErr("Please add your Full Name in Edit Profile above, then download your offer letter.");
      return null;
    }
    const { generateOfferLetterHTML, offerFormatDate, makeOfferId } = await import("@/lib/offerLetter");
    const department = me?.domains?.name || "Offensive Security";
    // Prefer the assigned member ID; fall back to a computed one if 029 hasn't populated it yet.
    const offerId = me.member_id || makeOfferId(department);
    let html = generateOfferLetterHTML({
      fullName,
      department,
      id: offerId,
      issueDate: offerFormatDate(new Date(me.created_at || Date.now())), // join date = signup date
    });
    // <title> becomes the default "Save as PDF" filename in the print dialog.
    html = html.replace("</head>", `<title>ZeroDayReapers-Offer-${offerId}</title></head>`);
    return { html, offerId };
  }

  // Open the letter in a new tab and trigger the browser's Print → "Save as PDF".
  // This is the browser's native VECTOR renderer: crisp text (no rasterization), a clear
  // dotted-zero, selectable text, and a clickable link — exactly as designed.
  async function downloadOfferLetter() {
    setErr(""); setOk("");
    setOfferBusy(true);
    try {
      const built = await buildOfferLetter();
      if (!built) return;
      const w = window.open("", "_blank");
      if (!w) { setErr("Popup blocked — allow popups for this site, then try again."); return; }
      w.document.write(built.html);
      w.document.close();
      w.onload = () => setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 400);
    } catch (e) {
      setErr("Could not open the offer letter: " + (e?.message || e));
    } finally {
      setOfferBusy(false);
    }
  }

  async function downloadInternPortfolio() {
    setErr(""); setOk("");
    try {
      const [{ data: submissions }, { data: docs }] = await Promise.all([
        supabase.from("submissions").select("status,feedback,graded_at,score_overall,score_completeness,score_accuracy,score_evidence,score_report,tasks(week,title)").eq("user_id", me.id).order("graded_at", { ascending: false }),
        supabase.from("documents").select("type,file_name,created_at").eq("user_id", me.id).order("created_at", { ascending: false }),
      ]);
      const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      const approved = (submissions || []).filter((s) => s.status === "approved");
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>ZDR Portfolio - ${esc(me.member_id || me.display_name)}</title><style>
        body{font-family:Arial,sans-serif;max-width:880px;margin:40px auto;color:#111;line-height:1.55}
        h1{margin:0;font-size:28px}.muted{color:#666}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}
        .box,.item{border:1px solid #ddd;padding:14px}.tag{display:inline-block;border:1px solid #e10600;color:#e10600;padding:2px 8px;margin:2px;font-size:12px}
      </style></head><body>
        <h1>${esc(me.full_name || me.display_name)}</h1>
        <p class="muted">${esc(me.member_id || "No member ID")} | ${esc(me.domains?.name || "Department")} | ${esc(me.ram || "RAM not set")}</p>
        <div class="grid">
          <div class="box"><b>${approved.length}</b><br><span class="muted">approved tasks</span></div>
          <div class="box"><b>${me.is_alumni ? "Graduated" : "In progress"}</b><br><span class="muted">standing</span></div>
          <div class="box"><b>${me.is_best_intern ? "Best Intern" : "Intern"}</b><br><span class="muted">recognition</span></div>
        </div>
        <h2>Approved Work</h2>
        ${(approved.length ? approved : submissions || []).map((s) => `<div class="item">
          <b>Week ${esc(s.tasks?.week)} - ${esc(s.tasks?.title || "Task")}</b><br>
          <span class="muted">Status: ${esc(s.status)}${s.score_overall != null ? ` | Score: ${esc(s.score_overall)} / 40` : ""}</span>
          ${s.feedback ? `<p>${esc(s.feedback)}</p>` : ""}
        </div>`).join("") || "<p class='muted'>No submissions yet.</p>"}
        <h2>Documents and Credentials</h2>
        <p>
          <span class="tag">Offer Letter available</span>
          ${me.certificate_key ? "<span class='tag'>Certificate uploaded</span>" : ""}
          ${me.lor_key ? "<span class='tag'>LOR uploaded</span>" : ""}
          ${(docs || []).map((d) => `<span class="tag">${esc(d.type || "document")}: ${esc(d.file_name || "file")}</span>`).join("")}
        </p>
      </body></html>`;
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `zdr-portfolio-${me.member_id || me.id}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setOk("Portfolio export downloaded.");
    } catch (e) {
      setErr(e.message || "Could not export portfolio.");
    }
  }

  // Founder: zero the ID counters so the next signup restarts at -001 in every department.
  async function resetIdCounters() {
    setErr(""); setOk("");
    if (!window.confirm("Reset all department ID counters? The next new intern in each department will start at -001.")) return;
    setResetBusy(true);
    const { error } = await supabase.rpc("reset_member_id_counters");
    setResetBusy(false);
    if (error) return setErr(error.message);
    setOk("ID counters reset — next signup starts at Cohort1-<DEPT>-001.");
  }

  // Founder: full portal reset. Requires typing RESET (destructive).
  async function resetPortal() {
    setErr(""); setOk("");
    if (resetConfirm.trim().toUpperCase() !== "RESET") { setErr('Type RESET in the box to confirm.'); return; }
    if (!window.confirm("FINAL CONFIRM: permanently wipe messages, announcements, DMs, tasks, submissions (incl. their R2 files), and delete all current interns? Founders, Admins, Alumni, the Alumni chat, Testimonials, documents and avatars are kept. This cannot be undone.")) return;
    setResetBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/portal/reset", { method: "POST", headers: { Authorization: `Bearer ${session?.access_token || ""}` } });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(out.error || "Reset failed."); return; }
      setResetConfirm("");
      setOk(`Portal reset complete (${out.r2Deleted || 0} file(s) purged). A fresh cohort can now sign up.`);
    } catch (e) {
      setErr(e.message || "Reset failed.");
    } finally {
      setResetBusy(false);
    }
  }

  // Load the issues I've reported (RLS returns only my own rows).
  async function loadMyIssues() {
    const { data } = await supabase.from("portal_issues")
      .select("id,category,body,status,created_at")
      .eq("user_id", me.id)
      .order("created_at", { ascending: false });
    setMyIssues(data || []);
  }

  // Submit a portal issue to the admins. Author name/email are snapshotted server-side.
  async function submitIssue(e) {
    e.preventDefault();
    setErr(""); setOk("");
    const body = issueBody.trim();
    if (!body) return setErr("Please describe the issue before submitting.");
    setIssueBusy(true);
    const { error } = await supabase.from("portal_issues").insert({ user_id: me.id, category: issueCategory, body });
    setIssueBusy(false);
    if (error) return setErr(error.message);
    setIssueBody("");
    setOk("Thanks! Your issue was sent to the admins.");
    loadMyIssues();
  }

  async function handleAvatarUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setOk("");
    setUploadingAvatar(true);

    try {
      const ext = file.name.split(".").pop();
      const path = `${me.id}/avatar_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = pub.publicUrl + "?t=" + Date.now();

      const { error: dbErr } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
      if (dbErr) throw dbErr;

      setMe((m) => ({ ...m, avatar_url: url }));
      setOk("Avatar updated successfully!");
    } catch (err) {
      setErr(err.message || "Failed to upload avatar.");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleProofUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr("");
    setOk("");
    setUploadingProof(true);

    try {
      // Private R2 storage (not the public avatars bucket). Store the R2 key; the
      // file is only reachable via a short-lived presigned URL for the owner + admins.
      const { key } = await uploadToR2(file, { kind: "payment" });
      const nowIso = new Date().toISOString();

      const { error: dbErr } = await supabase.from("profiles").update({
        payment_proof_url: key,
        payment_proof_submitted_at: nowIso,
      }).eq("id", me.id);
      if (dbErr) throw dbErr;

      setMe((m) => ({ ...m, payment_proof_url: key, payment_proof_submitted_at: nowIso }));
      setOk("🎉 Payment proof submitted successfully! Our admin team will review it.");
    } catch (err) {
      setErr(err.message || "Failed to upload payment proof.");
    } finally {
      setUploadingProof(false);
    }
  }

  // View a payment proof. New uploads are private R2 keys (presigned download);
  // legacy values are old public URLs (open directly).
  async function openProof(val) {
    if (!val) return;
    if (/^https?:\/\//.test(val)) { window.open(val, "_blank", "noopener"); return; }
    try { await downloadFromR2(val); } catch (e) { setErr(e.message); }
  }

  async function doPasswordUpdate() {
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) return setErr(error.message);
    setPw(""); setPwConfirm(""); setPwStep(false); setPwOtp("");
    setOk("🔒 Password updated. Signing you out of all devices…");
    supabase.from("profiles").update({ password_changed_at: new Date().toISOString() }).eq("id", me.id);
    supabase.rpc("log_my_activity", { p_type: "password_changed" });
    emailSelf("Your ZeroDay Reapers password was changed",
      "<p>Your account password was just changed. If this wasn't you, reset it immediately and contact us.</p>");
    // Force re-login everywhere after a password change.
    setTimeout(() => supabase.auth.signOut({ scope: "global" }), 1200);
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setErr(""); setOk("");
    const failed = PW_RULES.filter((r) => !r.test(pw));
    if (failed.length) return setErr("Password must include: " + failed.map((f) => f.label).join(", ") + ".");
    if (pw !== pwConfirm) return setErr("Passwords do not match.");
    // With 2FA enabled, Supabase requires an AAL2 session to change the password. If we're only at
    // AAL1, prompt for the authenticator code and step up (challengeAndVerify) before updating.
    if (pwStep) {
      if (!pwOtp.trim()) return setErr("Enter the 6-digit code from your authenticator app.");
      const { data: f } = await supabase.auth.mfa.listFactors();
      const factor = (f?.totp || []).find((x) => x.status === "verified");
      if (!factor) return setErr("No verified authenticator found — set up 2FA below first.");
      setPwBusy(true);
      const { error: chErr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: pwOtp.trim() });
      setPwBusy(false);
      if (chErr) return setErr(chErr.message);
    } else {
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal?.currentLevel === "aal1" && aal?.nextLevel === "aal2") { setPwStep(true); return; }
    }
    await doPasswordUpdate();
  }

  const isAdmin = me?.role === "admin";
  const inputStyle = "w-full panel-950 border border-blood/30 focus:border-blood outline-none px-4 py-2.5 text-neutral-100 rounded-sm font-mono text-sm";

  // ---- Two-factor authentication (all users) ----
  const [factors, setFactors] = useState([]);
  const [enrolling, setEnrolling] = useState(null); // { factorId, qr, secret }
  const [otp, setOtp] = useState("");
  const [devices, setDevices] = useState([]);
  const [lastLogin, setLastLogin] = useState(null);
  const [myDeviceId, setMyDeviceId] = useState(null);
  const [passkeySupported, setPasskeySupported] = useState(false);

  // Google Classroom (interns only): resolve their Department + RAM tier → the join link, so
  // they can join later if they skipped/forgot it at signup.
  const [classroom, setClassroom] = useState({ state: "loading", link: null, deptName: "", ram: "", confirmed: !!me?.classroom_confirmed });
  useEffect(() => {
    if (isAdmin || me?.is_alumni) { setClassroom((c) => ({ ...c, state: "hidden" })); return; }
    supabase.from("profiles").select("ram, classroom_confirmed, domains(key,name)").eq("id", me.id).single()
      .then(({ data }) => {
        const link = classroomLinkFor(data?.domains?.key, data?.ram);
        setClassroom({ state: link ? "ok" : "none", link, deptName: data?.domains?.name || "", ram: data?.ram || "", confirmed: !!data?.classroom_confirmed });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id]);

  // Every uploaded task attempt, including rejected versions that were later replaced. The current
  // submissions pointer is overlaid as a compatibility fallback until migration 068 is applied.
  useEffect(() => {
    if (isAdmin) { setFeedbackLoading(false); return; }
    let stopped = false;
    async function loadFeedbackHistory() {
      setFeedbackLoading(true);
      const [versionsResult, currentResult] = await Promise.all([
        supabase.from("submission_files")
          .select("*, tasks(week,title)")
          .eq("user_id", me.id)
          .order("uploaded_at", { ascending: false }),
        supabase.from("submissions")
          .select("*, tasks(week,title)")
          .eq("user_id", me.id)
          .order("submitted_at", { ascending: false }),
      ]);
      if (stopped) return;
      setFeedbackHistory(mergeSubmissionAttempts(versionsResult.data || [], currentResult.data || []));
      setFeedbackError((versionsResult.error || currentResult.error)?.message || "");
      setFeedbackLoading(false);
    }
    loadFeedbackHistory();
    return () => { stopped = true; };
  }, [me?.id, isAdmin]);
  async function toggleClassroomJoined() {
    const next = !classroom.confirmed;
    setClassroom((c) => ({ ...c, confirmed: next }));
    setMe?.((m) => ({ ...m, classroom_confirmed: next }));
    await supabase.rpc("set_classroom_confirmed", { p_value: next });
  }

  async function loadFactors() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp || []).filter((f) => f.status === "verified"));
  }
  useEffect(() => {
    loadFactors();
    loadMyIssues();
    try { setMyDeviceId(localStorage.getItem("zdr_device_id")); } catch { /* ignore */ }
    setPasskeySupported(typeof window !== "undefined" && !!window.PublicKeyCredential);
    supabase.from("user_devices").select("*").is("revoked_at", null).order("last_seen", { ascending: false }).then(({ data }) => setDevices(data || []));
    // The 2nd-most-recent login is the "last login" (the most recent is the current session).
    supabase.from("activity_events").select("created_at").eq("type", "login").order("created_at", { ascending: false }).limit(2)
      .then(({ data }) => setLastLogin(data?.[1]?.created_at || data?.[0]?.created_at || null));
  }, []);
  // Log out one device: revoke it (it signs itself out via Realtime), or sign out locally if it's this one.
  async function logoutDevice(d) {
    if (d.device_id === myDeviceId) { supabase.auth.signOut(); return; }
    await supabase.rpc("revoke_device", { p_device_id: d.device_id });
    setDevices((ds) => ds.filter((x) => x.id !== d.id));
  }

  async function startEnroll() {
    setErr(""); setOk("");
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error) return setErr(error.message);
    setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }
  async function confirmEnroll() {
    setErr("");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrolling.factorId, code: otp.trim() });
    if (error) return setErr(error.message);
    setEnrolling(null); setOtp(""); setOk("✅ Two-factor authentication enabled.");
    loadFactors();
  }
  async function removeFactor(id) {
    setErr("");
    const { error } = await supabase.auth.mfa.unenroll({ factorId: id });
    if (error) return setErr(error.message);
    setOk("Two-factor authentication disabled.");
    loadFactors();
  }

  return (
    <div className="min-h-screen text-neutral-100 flex flex-col font-mono">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-black/60 backdrop-blur-xl border-b border-blood/25">
        <div className="w-full flex items-center justify-between px-4 sm:px-6 py-3">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-blood hover:text-blood transition flex items-center gap-1"
            >
              ← Back to Portal
            </button>
            <span className="text-sm tracking-widest text-white font-bold uppercase">
              Profile Settings
            </span>
          </div>
          <div className="text-xs text-neutral-400 hidden sm:block truncate max-w-[45vw]">
            {me?.email} <span className="text-blood font-semibold">({isAdmin ? "Admin" : "Intern Candidate"})</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full p-4 md:p-8 space-y-8">
        {err && <div className="p-3 bg-blood/20 border border-blood text-blood text-xs rounded-sm">{err}</div>}
        {ok && <div className="p-3 bg-[#34d399]/20 border border-[#34d399] text-[#34d399] text-xs rounded-sm animate-pulse">{ok}</div>}

        <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-8 items-start min-w-0">
          {/* Left Column: Avatar & Quick Info */}
          <div className="panel border border-blood/20 p-6 rounded-sm flex flex-col items-center text-center space-y-4 shadow-xl">
            <div className="relative group">
              <div className="w-32 h-32 rounded-full overflow-hidden border-2 border-blood/50 bg-ink-950 flex items-center justify-center">
                {me?.avatar_url ? (
                  <img src={me.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-4xl text-blood font-bold">{me?.display_name?.slice(0, 2).toUpperCase() || "ZD"}</span>
                )}
              </div>
              <label className="absolute inset-0 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer text-xs uppercase tracking-widest text-white font-bold">
                {uploadingAvatar ? "Uploading…" : "Change Photo"}
                <input type="file" accept="image/*" className="hidden" disabled={uploadingAvatar} onChange={handleAvatarUpload} />
              </label>
            </div>
            <div>
              <h2 className="text-lg text-white font-bold truncate max-w-[220px]">{me?.display_name}</h2>
              <p className="text-xs text-neutral-400">{me?.email}</p>
              <div className="mt-2 inline-block px-2.5 py-0.5 bg-blood/10 border border-blood/30 text-blood text-[10px] uppercase tracking-widest rounded-sm font-semibold">
                {isAdmin ? "Administrator" : "Intern Candidate"}
              </div>
            </div>
          </div>

          {/* Right Column: Edit Profile & Payment Proof */}
          <div className="space-y-6">
            {/* Google Classroom — interns can (re)join their department's classroom anytime */}
            {classroom.state !== "hidden" && (
              <section className="panel border border-[#34d399]/30 p-6 rounded-sm shadow-xl">
                <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3 mb-4 flex items-center gap-2">
                  <span>🎓 Google Classroom</span>
                </h3>
                {classroom.state === "loading" ? (
                  <div className="h-10 w-48 bg-white/5 rounded-sm animate-pulse" />
                ) : classroom.state === "none" ? (
                  <p className="text-xs text-amber-400/90">
                    No classroom is mapped to your Department{classroom.ram ? "" : " / RAM tier"} yet — please contact an admin so we can set it up.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs text-neutral-400">
                      Your class{classroom.deptName ? <> for <span className="text-neutral-200">{classroom.deptName}</span></> : ""}{classroom.ram ? <> · <span className="text-neutral-200">{classroom.ram}</span></> : ""}. Join here if you skipped it at signup.
                    </p>
                    <div className="flex flex-wrap items-center gap-3">
                      <a href={classroom.link} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-[#34d399]/15 border border-[#34d399] text-[#34d399] px-4 py-2.5 rounded-sm text-xs uppercase tracking-widest font-bold hover:bg-[#34d399] hover:text-ink-950 transition">
                        Open Google Classroom ↗
                      </a>
                      <label className="flex items-center gap-2 text-xs text-neutral-300 cursor-pointer select-none">
                        <input type="checkbox" checked={classroom.confirmed} onChange={toggleClassroomJoined} className="accent-[#34d399]" />
                        I&apos;ve joined
                      </label>
                    </div>
                    {classroom.confirmed && <p className="text-[11px] text-[#34d399]">✓ Marked as joined.</p>}
                  </div>
                )}
              </section>
            )}

            {/* Profile Form */}
            <section className="panel border border-blood/20 p-6 rounded-sm shadow-xl space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3 flex items-center justify-between">
                <span>Personal Information</span>
                <span className="text-[10px] text-neutral-500 font-normal">Publicly visible in group chats</span>
              </h3>
              <form onSubmit={handleSaveDetails} className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Full Name *</label>
                  <input
                    type="text"
                    required
                    className={inputStyle}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your exact full name"
                  />
                  <p className="text-[10px] text-amber-400/80 mt-1">Printed on your Offer Letter & Certificate — enter it exactly.</p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Display Name (Optional)</label>
                  <input
                    type="text"
                    className={inputStyle}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Handle shown in chat — defaults to your full name"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5 flex items-center justify-between">
                    <span>Gender</span>
                    <span className="text-[10px] text-neutral-500 font-mono lowercase tracking-normal">
                      {isAdmin ? "(you can update this)" : "(permanent · cannot be changed)"}
                    </span>
                  </label>
                  {isAdmin ? (
                    <select className={inputStyle} value={gender} onChange={(e) => setGender(e.target.value)}>
                      <option value="">Select gender…</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                    </select>
                  ) : (
                    <input
                      type="text"
                      disabled
                      className={`${inputStyle} opacity-60 cursor-not-allowed bg-ink-950/60 border-neutral-800 text-neutral-400 font-mono capitalize`}
                      value={me?.gender || "Not specified"}
                    />
                  )}
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5 flex items-center justify-between">
                    <span>Country</span>
                    <span className="text-[10px] text-neutral-500 font-mono lowercase tracking-normal">
                      {isAdmin ? "(you can update this)" : "(permanent · cannot be changed)"}
                    </span>
                  </label>
                  {isAdmin ? (
                    <select className={inputStyle} value={country} onChange={(e) => setCountry(e.target.value)}>
                      <option value="">Select country…</option>
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.dial})</option>)}
                    </select>
                  ) : (
                    <div className={`${inputStyle} opacity-70 cursor-not-allowed bg-ink-950/60 border-neutral-800 text-neutral-300 font-mono flex items-center gap-2`}>
                      {me?.country ? (<><Flag code={me.country} /> {countryNameFor(me.country)}</>) : "Not specified"}
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Phone Number</label>
                  <div className="flex items-stretch gap-2">
                    <span className="flex items-center gap-1.5 px-3 rounded-sm border border-neutral-800 bg-ink-950/60 text-neutral-400 font-mono text-sm whitespace-nowrap">
                      {me?.country ? (<><Flag code={me.country} /> {me?.dial_code || dialFor(me.country)}</>) : "＋"}
                    </span>
                    <input
                      type="tel"
                      inputMode="tel"
                      className={`${inputStyle} flex-1`}
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Phone number"
                    />
                  </div>
                  <p className="text-[10px] text-neutral-500 mt-1">You can change your number — your country dialing code is fixed.</p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">LinkedIn (optional)</label>
                  <input
                    type="url"
                    className={inputStyle}
                    value={linkedin}
                    onChange={(e) => setLinkedin(e.target.value)}
                    placeholder="https://www.linkedin.com/in/your-profile"
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">Only a personal profile (www.linkedin.com/in/…) or company page (www.linkedin.com/company/…) is accepted — other links are discarded.</p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">GitHub (optional)</label>
                  <input
                    type="url"
                    className={inputStyle}
                    value={github}
                    onChange={(e) => setGithub(e.target.value)}
                    placeholder="https://github.com/your-username"
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">Only a github.com profile or org link (github.com/…) is accepted — other links are discarded.</p>
                </div>

                {me?.member_id && (
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5 flex items-center justify-between">
                      <span>Member ID</span>
                      <span className="text-[10px] text-neutral-500 font-mono lowercase tracking-normal">(auto-generated)</span>
                    </label>
                    <input
                      type="text"
                      disabled
                      className={`${inputStyle} opacity-60 cursor-not-allowed bg-ink-950/60 border-neutral-800 text-neutral-300 font-mono tracking-wider`}
                      value={me.member_id}
                    />
                  </div>
                )}

                {!isAdmin && (
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5 flex items-center justify-between">
                      <span>System RAM</span>
                      <span className="text-[10px] text-neutral-500 font-mono lowercase tracking-normal">(set at signup · admin can change)</span>
                    </label>
                    <input
                      type="text"
                      disabled
                      className={`${inputStyle} opacity-60 cursor-not-allowed bg-ink-950/60 border-neutral-800 text-neutral-400 font-mono`}
                      value={me?.ram || "Not specified"}
                    />
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full sm:w-auto btn-neon font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm hover:bg-blood-glow transition shadow-lg shadow-blood/10"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </section>

            {/* Complete task feedback history (interns) — every upload version, grouped by week. */}
            {!isAdmin && (
              <section className="panel border border-blood/20 p-6 rounded-sm shadow-xl space-y-4">
                <div className="border-b border-neutral-800 pb-3">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-white">Weekly feedback &amp; marks</h3>
                  <p className="text-[11px] text-neutral-500 mt-1">Every submission attempt stays here, including rejected versions that you later replaced.</p>
                </div>
                {feedbackLoading ? (
                  <p className="text-xs text-neutral-500 animate-pulse">Loading your feedback history…</p>
                ) : feedbackError && feedbackHistory.length === 0 ? (
                  <p className="text-xs text-blood">Could not load feedback history: {feedbackError}</p>
                ) : feedbackHistory.length === 0 ? (
                  <p className="text-xs text-neutral-500">No task attempts yet. Your Week 1, Week 2, and later feedback will appear here after you submit.</p>
                ) : (
                  <div className="space-y-6 max-h-[42rem] overflow-y-auto pr-1">
                    {groupAttemptsByWeek(feedbackHistory).map(({ week, items }) => (
                      <div key={week}>
                        <h4 className="font-mono text-xs uppercase tracking-[0.2em] text-blood mb-2">
                          {week === "other" ? "Other task feedback" : `Week ${week} feedback`}
                          <span className="text-neutral-600 ml-2">{items.length} attempt{items.length === 1 ? "" : "s"}</span>
                        </h4>
                        <div className="space-y-3">
                          {items.map((attempt, index) => (
                            <SubmissionFeedbackCard
                              key={attempt.id || `${attempt.task_id}-${attempt.file_path}-${index}`}
                              attempt={attempt}
                              task={attempt.tasks}
                              attemptLabel={attemptLabelFor(attempt, items)}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {/* Offer Letter (interns) */}
            {!isAdmin && (
              <section className="panel border border-blood/20 p-6 rounded-sm shadow-xl space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3 flex items-center gap-2">
                  📄 Internship Offer Letter
                </h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Your official ZeroDay Reapers offer letter — personalized with your name
                  {me?.member_id ? <>, ID (<span className="font-mono text-neutral-300">{me.member_id}</span>)</> : ""}
                  {me?.domains?.name ? `, department (${me.domains.name})` : ""}, and the date you joined.
                </p>
                <button
                  onClick={downloadOfferLetter}
                  disabled={offerBusy}
                  className="inline-flex items-center gap-2 btn-neon font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm hover:bg-blood-glow transition shadow-lg shadow-blood/10 disabled:opacity-50"
                >
                  {offerBusy ? "Opening…" : "⬇ Download Offer Letter (PDF)"}
                </button>
                <p className="text-[10px] text-neutral-500">
                  Opens a print preview — choose <span className="text-neutral-300">“Save as PDF”</span> as the destination.
                </p>
              </section>
            )}

            {/* Portfolio Export (interns) */}
            {!isAdmin && (
              <section className="panel border border-blood/20 p-6 rounded-sm shadow-xl space-y-3">
                <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3 flex items-center gap-2">
                  Internship Portfolio Export
                </h3>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Download a portable HTML portfolio with your profile, department, member ID, approved work, rubric scores, feedback, and credential status.
                </p>
                <button
                  onClick={downloadInternPortfolio}
                  className="inline-flex items-center gap-2 btn-neon font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm hover:bg-blood-glow transition shadow-lg shadow-blood/10"
                >
                  Download Portfolio
                </button>
              </section>
            )}

            {/* Security Center */}
            <section className="panel border border-blood/20 p-6 rounded-sm shadow-xl space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3">
                Security Center
              </h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="border border-neutral-800 rounded-sm p-3">
                  <div className={factors.length ? "text-[#34d399] text-lg font-bold" : "text-amber-400 text-lg font-bold"}>{factors.length ? "On" : "Off"}</div>
                  <div className="text-[10px] uppercase tracking-widest text-neutral-500">two-factor auth</div>
                </div>
                <div className="border border-neutral-800 rounded-sm p-3">
                  <div className={passkeySupported ? "text-[#34d399] text-lg font-bold" : "text-neutral-500 text-lg font-bold"}>{passkeySupported ? "Ready" : "Unavailable"}</div>
                  <div className="text-[10px] uppercase tracking-widest text-neutral-500">passkey support</div>
                </div>
                <div className="border border-neutral-800 rounded-sm p-3">
                  <div className="text-white text-lg font-bold">{devices.length}</div>
                  <div className="text-[10px] uppercase tracking-widest text-neutral-500">active devices</div>
                </div>
                <div className="border border-neutral-800 rounded-sm p-3">
                  <div className="text-white text-lg font-bold">{me.password_changed_at ? new Date(me.password_changed_at).toLocaleDateString() : "Never"}</div>
                  <div className="text-[10px] uppercase tracking-widest text-neutral-500">password changed</div>
                </div>
              </div>
              <p className="text-xs text-neutral-500 leading-relaxed">
                Passkey/WebAuthn registration needs a server challenge endpoint before it can be enabled for login. This panel detects browser readiness now; keep 2FA enabled and remove unknown devices below.
              </p>
            </section>

            {/* Change Password (everyone) */}
            <section className="panel border border-blood/20 p-6 rounded-sm shadow-xl">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3 mb-4 flex items-center gap-2">
                🔒 Change Password
              </h3>
              <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">New Password</label>
                  <PasswordInput
                    className={inputStyle}
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    placeholder="Min 12 characters"
                    autoComplete="new-password"
                  />
                  {pw && (
                    <ul className="text-[10px] space-y-0.5 mt-2">
                      {PW_RULES.map((r) => {
                        const good = r.test(pw);
                        return (
                          <li key={r.label} className={good ? "text-[#34d399]" : "text-neutral-500"}>
                            {good ? "✓" : "○"} {r.label}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Confirm New Password</label>
                  <PasswordInput
                    className={inputStyle}
                    value={pwConfirm}
                    onChange={(e) => setPwConfirm(e.target.value)}
                    placeholder="Re-enter new password"
                    autoComplete="new-password"
                  />
                  {pwConfirm && pw !== pwConfirm && <p className="text-[10px] text-blood mt-1">Passwords do not match.</p>}
                </div>
                {pwStep && (
                  <div>
                    <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Authenticator code</label>
                    <input
                      className={inputStyle}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit code from your app"
                      value={pwOtp}
                      onChange={(e) => setPwOtp(e.target.value)}
                    />
                    <p className="text-[10px] text-amber-400/90 mt-1">Two-factor is enabled — enter your authenticator code to confirm the password change.</p>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={pwBusy || !pw}
                  className="w-full sm:w-auto btn-neon font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm hover:bg-blood-glow transition shadow-lg shadow-blood/10 disabled:opacity-50"
                >
                  {pwBusy ? "Updating…" : pwStep ? "Verify & Update Password" : "Update Password"}
                </button>
              </form>
            </section>

            {/* Report a Portal Issue (everyone — permanent) */}
            <section className="panel border border-neon-cyan/30 p-6 rounded-sm shadow-xl space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3 flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">🐞 Report a Portal Issue</span>
                <span className="text-[10px] text-neutral-500 font-normal normal-case tracking-normal">Sent privately to the admins</span>
              </h3>
              <p className="text-xs text-neutral-400 leading-relaxed">
                Found a bug, something broken, or can&apos;t access a feature? Let the ZeroDay Reapers team know — they review every report in the admin panel.
              </p>
              <form onSubmit={submitIssue} className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Category</label>
                  <select className={inputStyle} value={issueCategory} onChange={(e) => setIssueCategory(e.target.value)}>
                    <option value="bug">Bug / something broken</option>
                    <option value="ui">Display / layout problem</option>
                    <option value="access">Can&apos;t access a feature</option>
                    <option value="account">Account / login issue</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Describe the issue</label>
                  <textarea
                    className={`${inputStyle} min-h-[120px] resize-y`}
                    value={issueBody}
                    onChange={(e) => setIssueBody(e.target.value)}
                    maxLength={2000}
                    placeholder="What happened? What were you trying to do? Steps to reproduce help a lot."
                  />
                  <p className="text-[10px] text-neutral-500 mt-1 text-right">{issueBody.length}/2000</p>
                </div>
                <button
                  type="submit"
                  disabled={issueBusy || !issueBody.trim()}
                  className="w-full sm:w-auto btn-ghost font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm transition disabled:opacity-50"
                >
                  {issueBusy ? "Sending…" : "Submit Issue"}
                </button>
              </form>

              {myIssues.length > 0 && (
                <div className="pt-4 border-t border-neutral-800 space-y-2">
                  <div className="text-[10px] uppercase tracking-widest text-neutral-500">Your reported issues</div>
                  {myIssues.map((it) => (
                    <div key={it.id} className="border border-neutral-800 rounded-sm p-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                          {ISSUE_LABELS[it.category] || it.category} · {new Date(it.created_at).toLocaleDateString()}
                        </div>
                        <p className="text-xs text-neutral-300 mt-1 break-words whitespace-pre-wrap">{it.body}</p>
                      </div>
                      <span className={`shrink-0 text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-sm border ${it.status === "resolved" ? "border-[#34d399]/40 text-[#34d399] bg-[#34d399]/10" : "border-amber-500/40 text-amber-400 bg-amber-500/10"}`}>
                        {it.status === "resolved" ? "Resolved" : "Open"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Week 3 Payment Proof Section (For Interns Only) */}
            {!isAdmin && (
              <section className="panel border border-amber-500/40 p-6 rounded-sm shadow-xl space-y-4 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl -mr-6 -mt-6 pointer-events-none" />
                <h3 className="text-sm font-bold uppercase tracking-widest text-amber-400 border-b border-neutral-800 pb-3 flex items-center justify-between">
                  <span>💳 Week 3 Internship Fee Payment Proof</span>
                  <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-sm">Mandatory Requirement</span>
                </h3>

                <div className="text-xs text-neutral-300 leading-relaxed space-y-2">
                  <p>
                    During <span className="text-white font-bold">Week 3</span> up until <span className="text-white font-bold">Week 4 begins</span>, all intern candidates are required to submit a screenshot proof of their fee payment.
                  </p>
                  <p className="text-neutral-400 text-[11px] bg-black/40 p-3 border-l-2 border-amber-500 rounded-r-sm">
                    ⚠️ <strong className="text-amber-400">Important Policy:</strong> When Week 4 starts, any intern account that has not submitted valid payment proof will be <strong className="text-red-400 underline">automatically removed</strong> from the portal. If you register again after being removed, you will require explicit manual approval from an administrator.
                  </p>
                </div>

                <div className="pt-2">
                  {me?.payment_proof_url ? (
                    <div className="bg-black/60 border border-[#34d399]/40 p-4 rounded-sm space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-[#34d399] font-bold text-xs uppercase tracking-wider">
                          <span>✅ Payment Proof Submitted</span>
                        </div>
                        {me.payment_proof_submitted_at && (
                          <span className="text-[10px] text-neutral-400 font-mono">
                            {new Date(me.payment_proof_submitted_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 pt-1">
                        <button
                          type="button"
                          onClick={() => openProof(me.payment_proof_url)}
                          className="text-xs uppercase tracking-widest bg-[#34d399]/20 border border-[#34d399] text-[#34d399] px-4 py-2 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition font-bold inline-flex items-center gap-1.5"
                        >
                          <span>📄 View Uploaded Proof</span>
                          <span className="text-[10px]">↗</span>
                        </button>
                        <label className="text-xs uppercase tracking-widest bg-neutral-800 border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-amber-500 hover:text-amber-400 transition font-bold cursor-pointer inline-block">
                          {uploadingProof ? "Uploading…" : "Replace Proof"}
                          <input type="file" accept="image/*,.pdf" className="hidden" disabled={uploadingProof} onChange={handleProofUpload} />
                        </label>
                      </div>
                    </div>
                  ) : (
                    <div className="border-2 border-dashed border-amber-500/40 hover:border-amber-500/80 bg-black/30 p-6 rounded-sm text-center transition">
                      <div className="text-2xl mb-2">📸</div>
                      <p className="text-xs text-neutral-300 font-semibold mb-1">No payment proof uploaded yet</p>
                      <p className="text-[11px] text-neutral-500 mb-4">Upload your screenshot or transaction receipt (JPG, PNG, or PDF)</p>
                      <label className="inline-block bg-amber-500 text-ink-950 font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm hover:bg-amber-400 transition cursor-pointer shadow-lg shadow-amber-500/10">
                        {uploadingProof ? "Uploading Proof…" : "Upload Screenshot Proof"}
                        <input type="file" accept="image/*,.pdf" className="hidden" disabled={uploadingProof} onChange={handleProofUpload} />
                      </label>
                    </div>
                  )}
                </div>
              </section>
            )}

            {me?.is_founder && (
              <section className="mt-8 border border-red-600/50 bg-red-950/10 p-6 rounded-sm space-y-5">
                <h2 className="text-sm font-bold tracking-widest text-red-400 flex items-center gap-2">👑 FOUNDER · DANGER ZONE</h2>

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-red-900/40 pb-4">
                  <div className="min-w-0">
                    <div className="text-sm text-white font-semibold">Reset ID counters</div>
                    <p className="text-[11px] text-neutral-400">Next signup restarts at <span className="font-mono">Cohort1-&lt;DEPT&gt;-001</span> in every department. Existing members keep their IDs.</p>
                  </div>
                  <button onClick={resetIdCounters} disabled={resetBusy}
                    className="text-xs uppercase tracking-widest border border-amber-500 text-amber-400 px-4 py-2 rounded-sm hover:bg-amber-500 hover:text-ink-950 transition disabled:opacity-50">
                    {resetBusy ? "…" : "Reset IDs"}
                  </button>
                </div>

                <div className="space-y-2">
                  <div className="text-sm text-white font-semibold">Reset all DB (fresh cohort)</div>
                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    Permanently deletes all messages, announcements, DMs, tasks, submissions, and every current
                    intern account, and zeroes the ID counters. <span className="text-neutral-200">Kept:</span> Founders,
                    Admins, Alumni, the Alumni chat, and Testimonials &amp; Feedback. <span className="text-red-400 font-semibold">This cannot be undone.</span>
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input
                      value={resetConfirm}
                      onChange={(e) => setResetConfirm(e.target.value)}
                      placeholder="Type RESET to confirm"
                      className="panel-950 border border-red-600/50 focus:border-red-500 outline-none px-3 py-2 text-sm text-neutral-100 rounded-sm font-mono"
                    />
                    <button onClick={resetPortal} disabled={resetBusy || resetConfirm.trim().toUpperCase() !== "RESET"}
                      className="text-xs uppercase tracking-widest bg-red-600 text-white px-4 py-2 rounded-sm hover:bg-red-500 transition disabled:opacity-40 disabled:cursor-not-allowed font-bold">
                      {resetBusy ? "Resetting…" : "⚠ Reset All DB"}
                    </button>
                  </div>
                </div>
              </section>
            )}

            <section className="mt-8">
              <h2 className="text-sm font-bold tracking-widest text-white mb-3">SECURITY</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <div className="border border-neutral-800 rounded-sm p-4">
                  <div className="text-[10px] uppercase tracking-widest text-neutral-500">Last login</div>
                  <div className="text-sm text-neutral-200 mt-1">{lastLogin ? new Date(lastLogin).toLocaleString() : "—"}</div>
                </div>
                <div className="border border-neutral-800 rounded-sm p-4">
                  <div className="text-[10px] uppercase tracking-widest text-neutral-500">Last password change</div>
                  <div className="text-sm text-neutral-200 mt-1">{me.password_changed_at ? new Date(me.password_changed_at).toLocaleString() : "—"}</div>
                </div>
              </div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-widest text-neutral-500">Devices &amp; active sessions</div>
                <button onClick={() => supabase.auth.signOut({ scope: "global" })} className="text-[11px] uppercase tracking-widest border border-blood text-blood px-3 py-1.5 rounded-sm hover:bg-blood hover:text-ink-950 transition">
                  Log out everywhere
                </button>
              </div>
              <div className="space-y-2">
                {devices.length === 0 && <p className="text-xs text-neutral-600">No devices recorded yet.</p>}
                {devices.map((d) => {
                  const where = [d.city, d.country].filter(Boolean).join(", ");
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-3 border border-neutral-800 rounded-sm p-3">
                      <div className="min-w-0">
                        <div className="text-xs text-neutral-200 truncate font-medium" title={d.user_agent || ""}>{deviceLabel(d)}</div>
                        <div className="text-[10px] text-neutral-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <span>{where ? `📍 ${where}` : "📍 Location unknown"}</span>
                          <span className="text-neutral-700">·</span>
                          <span>Last seen {new Date(d.last_seen).toLocaleString()}</span>
                        </div>
                      </div>
                      {d.device_id === myDeviceId
                        ? <span className="text-[10px] uppercase tracking-widest text-[#34d399] shrink-0">This device</span>
                        : <button onClick={() => logoutDevice(d)} className="text-[11px] text-blood hover:underline shrink-0">Log out</button>}
                    </div>
                  );
                })}
              </div>
            </section>

            {(
              <section className="mt-8">
                <h2 className="text-sm font-bold tracking-widest text-white mb-3">TWO-FACTOR AUTHENTICATION</h2>
                {factors.length > 0 ? (
                  <div className="flex items-center justify-between gap-4 border border-[#34d399]/40 bg-[#34d399]/5 p-4 rounded-sm">
                    <span className="text-xs text-[#34d399] font-bold">✅ 2FA is enabled on this account.</span>
                    <button onClick={() => removeFactor(factors[0].id)} className="text-[11px] uppercase tracking-widest border border-neutral-600 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-blood hover:text-blood transition">
                      Disable
                    </button>
                  </div>
                ) : enrolling ? (
                  <div className="border border-blood/30 p-4 rounded-sm space-y-3">
                    <p className="text-xs text-neutral-400">Scan this QR in your authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code.</p>
                    {/* qr_code is an SVG data URL from Supabase */}
                    <img src={enrolling.qr} alt="2FA QR" className="w-40 h-40 bg-white p-2 rounded" />
                    <p className="text-[11px] text-neutral-500 break-all">Or enter this secret manually: <span className="text-neutral-300">{enrolling.secret}</span></p>
                    <div className="flex gap-2">
                      <input value={otp} onChange={(e) => setOtp(e.target.value)} placeholder="6-digit code" className={inputStyle + " max-w-[160px]"} />
                      <button onClick={confirmEnroll} className="btn-neon font-bold uppercase tracking-widest text-xs px-4 rounded-sm hover:bg-blood-glow transition">Verify & enable</button>
                      <button onClick={() => { setEnrolling(null); setOtp(""); }} className="text-[11px] uppercase tracking-widest border border-neutral-700 text-neutral-400 px-3 rounded-sm hover:text-blood transition">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4 border border-neutral-800 p-4 rounded-sm">
                    <span className="text-xs text-neutral-400">Add a second layer of security to your account.</span>
                    <button onClick={startEnroll} className="text-[11px] uppercase tracking-widest btn-neon font-bold px-4 py-1.5 rounded-sm hover:bg-blood-glow transition">
                      Enable 2FA
                    </button>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
