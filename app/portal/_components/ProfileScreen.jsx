"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { uploadToR2, downloadFromR2 } from "@/lib/r2client";
import PasswordInput from "./PasswordInput";
import { emailSelf } from "@/lib/notify";
import { COUNTRIES, dialFor, countryNameFor } from "@/lib/countries";
import Flag from "@/app/_components/Flag";

// Same strength policy as signup (also enforce it server-side in Supabase).
const PW_RULES = [
  { label: "12+ characters", test: (p) => p.length >= 12 },
  { label: "an uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "a lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "a number", test: (p) => /[0-9]/.test(p) },
  { label: "a symbol", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function ProfileScreen({ me, setMe, onBack }) {
  const [displayName, setDisplayName] = useState(me?.display_name || "");
  const [fullName, setFullName] = useState(me?.full_name || "");
  const [gender, setGender] = useState(me?.gender || ""); // admins can edit their own
  const [phone, setPhone] = useState(me?.phone || "");     // editable; country stays fixed
  const [country, setCountry] = useState(me?.country || ""); // admins/founders can change their own
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [pw, setPw] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [offerBusy, setOfferBusy] = useState(false);

  async function handleSaveDetails(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    if (!displayName.trim()) return setErr("Display name is required.");

    const updates = {
      display_name: displayName.trim(),
      full_name: fullName.trim() || null,
      phone: phone.trim() || null,
    };
    // Admins may set/change their own gender (students can't after signup).
    if (isAdmin && gender) updates.gender = gender;
    // Admins/founders may change their own country (interns cannot).
    if (isAdmin) { updates.country = country || null; updates.dial_code = country ? dialFor(country) : null; }

    const { error } = await supabase.from("profiles").update(updates).eq("id", me.id);
    if (error) return setErr(error.message);

    setMe((m) => ({ ...m, ...updates }));
    setOk("Profile updated successfully!");
  }

  // Build + download the personalized offer letter as a PDF (name, ID, department, join date).
  async function downloadOfferLetter() {
    setErr(""); setOk("");
    const fullName = (me.full_name || "").trim();
    if (!fullName) {
      setErr("Please add your Full Name in Edit Profile above, then download your offer letter.");
      return;
    }
    setOfferBusy(true);
    try {
      const [{ generateOfferLetterHTML, offerFormatDate, makeOfferId }, mod] = await Promise.all([
        import("@/lib/offerLetter"),
        import("html2pdf.js"),
      ]);
      const html2pdf = mod.default;
      const department = me?.domains?.name || "Offensive Security";
      // Prefer the assigned member ID; fall back to a computed one if 029 hasn't populated it yet.
      const offerId = me.member_id || makeOfferId(department);
      const html = generateOfferLetterHTML({
        fullName,
        department,
        id: offerId,
        issueDate: offerFormatDate(new Date(me.created_at || Date.now())), // join date = signup date
      });
      const holder = document.createElement("div");
      holder.innerHTML = html;
      const style = holder.querySelector("style");
      if (style) document.head.appendChild(style);
      const doc = holder.querySelector(".doc");
      doc.style.position = "fixed"; doc.style.left = "-10000px"; doc.style.top = "0"; doc.style.zIndex = "-1";
      document.body.appendChild(doc);
      const opt = {
        margin: 0,
        filename: `ZeroDayReapers-Offer-${offerId}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: "#070809", useCORS: true },
        jsPDF: { unit: "px", format: [794, 1123], orientation: "portrait" },
      };
      await html2pdf().set(opt).from(doc).save();
      doc.remove();
      if (style) style.remove();
      setOk("Offer letter downloaded ✓");
    } catch (e) {
      setErr("Could not generate the offer letter: " + (e?.message || e));
    } finally {
      setOfferBusy(false);
    }
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

  async function handleChangePassword(e) {
    e.preventDefault();
    setErr(""); setOk("");
    const failed = PW_RULES.filter((r) => !r.test(pw));
    if (failed.length) return setErr("Password must include: " + failed.map((f) => f.label).join(", ") + ".");
    if (pw !== pwConfirm) return setErr("Passwords do not match.");
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) return setErr(error.message);
    setPw(""); setPwConfirm("");
    setOk("🔒 Password updated. Signing you out of all devices…");
    supabase.from("profiles").update({ password_changed_at: new Date().toISOString() }).eq("id", me.id);
    supabase.rpc("log_my_activity", { p_type: "password_changed" });
    emailSelf("Your ZeroDay Reapers password was changed",
      "<p>Your account password was just changed. If this wasn't you, reset it immediately and contact us.</p>");
    // Force re-login everywhere after a password change.
    setTimeout(() => supabase.auth.signOut({ scope: "global" }), 1200);
  }

  const isAdmin = me?.role === "admin";
  const inputStyle = "w-full bg-ink-950 border border-blood/30 focus:border-blood outline-none px-4 py-2.5 text-neutral-100 rounded-sm font-mono text-sm";

  // ---- Two-factor authentication (all users) ----
  const [factors, setFactors] = useState([]);
  const [enrolling, setEnrolling] = useState(null); // { factorId, qr, secret }
  const [otp, setOtp] = useState("");
  const [devices, setDevices] = useState([]);
  const [lastLogin, setLastLogin] = useState(null);
  const [myDeviceId, setMyDeviceId] = useState(null);

  async function loadFactors() {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp || []).filter((f) => f.status === "verified"));
  }
  useEffect(() => {
    loadFactors();
    try { setMyDeviceId(localStorage.getItem("zdr_device_id")); } catch { /* ignore */ }
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
    <div className="min-h-screen bg-ink-950 text-neutral-100 flex flex-col font-mono">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-black border-b border-blood/20">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
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
          <div className="text-xs text-neutral-400">
            {me?.email} <span className="text-blood font-semibold">({isAdmin ? "Admin" : "Intern Candidate"})</span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-4 md:p-8 space-y-8">
        {err && <div className="p-3 bg-blood/20 border border-blood text-blood text-xs rounded-sm">{err}</div>}
        {ok && <div className="p-3 bg-[#34d399]/20 border border-[#34d399] text-[#34d399] text-xs rounded-sm animate-pulse">{ok}</div>}

        <div className="grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] gap-8 items-start min-w-0">
          {/* Left Column: Avatar & Quick Info */}
          <div className="bg-ink-900 border border-blood/20 p-6 rounded-sm flex flex-col items-center text-center space-y-4 shadow-xl">
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
            {/* Profile Form */}
            <section className="bg-ink-900 border border-blood/20 p-6 rounded-sm shadow-xl space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3 flex items-center justify-between">
                <span>Personal Information</span>
                <span className="text-[10px] text-neutral-500 font-normal">Publicly visible in group chats</span>
              </h3>
              <form onSubmit={handleSaveDetails} className="space-y-4">
                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Display Name *</label>
                  <input
                    type="text"
                    required
                    className={inputStyle}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Neo or ShadowReaper"
                  />
                  <p className="text-[10px] text-neutral-500 mt-1">This is your handle shown in department rooms and direct messages.</p>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Full Name (Optional)</label>
                  <input
                    type="text"
                    className={inputStyle}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your legal or full name"
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
                    className="w-full sm:w-auto bg-blood text-ink-950 font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm hover:bg-blood-glow transition shadow-lg shadow-blood/10"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </section>

            {/* Offer Letter (interns) */}
            {!isAdmin && (
              <section className="bg-ink-900 border border-blood/20 p-6 rounded-sm shadow-xl space-y-3">
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
                  className="inline-flex items-center gap-2 bg-blood text-ink-950 font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm hover:bg-blood-glow transition shadow-lg shadow-blood/10 disabled:opacity-50"
                >
                  {offerBusy ? "Generating PDF…" : "⬇ Download Offer Letter (PDF)"}
                </button>
              </section>
            )}

            {/* Change Password (everyone) */}
            <section className="bg-ink-900 border border-blood/20 p-6 rounded-sm shadow-xl">
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
                <button
                  type="submit"
                  disabled={pwBusy || !pw}
                  className="w-full sm:w-auto bg-blood text-ink-950 font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm hover:bg-blood-glow transition shadow-lg shadow-blood/10 disabled:opacity-50"
                >
                  {pwBusy ? "Updating…" : "Update Password"}
                </button>
              </form>
            </section>

            {/* Week 3 Payment Proof Section (For Interns Only) */}
            {!isAdmin && (
              <section className="bg-ink-900 border border-amber-500/40 p-6 rounded-sm shadow-xl space-y-4 relative overflow-hidden">
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
                {devices.map((d) => (
                  <div key={d.id} className="flex items-center justify-between gap-3 border border-neutral-800 rounded-sm p-3">
                    <div className="min-w-0">
                      <div className="text-xs text-neutral-300 truncate">{d.user_agent || "Unknown device"}</div>
                      <div className="text-[10px] text-neutral-600">Last seen {new Date(d.last_seen).toLocaleString()}</div>
                    </div>
                    {d.device_id === myDeviceId
                      ? <span className="text-[10px] uppercase tracking-widest text-[#34d399] shrink-0">This device</span>
                      : <button onClick={() => logoutDevice(d)} className="text-[11px] text-blood hover:underline shrink-0">Log out</button>}
                  </div>
                ))}
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
                      <button onClick={confirmEnroll} className="bg-blood text-ink-950 font-bold uppercase tracking-widest text-xs px-4 rounded-sm hover:bg-blood-glow transition">Verify & enable</button>
                      <button onClick={() => { setEnrolling(null); setOtp(""); }} className="text-[11px] uppercase tracking-widest border border-neutral-700 text-neutral-400 px-3 rounded-sm hover:text-blood transition">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4 border border-neutral-800 p-4 rounded-sm">
                    <span className="text-xs text-neutral-400">Add a second layer of security to your account.</span>
                    <button onClick={startEnroll} className="text-[11px] uppercase tracking-widest bg-blood text-ink-950 font-bold px-4 py-1.5 rounded-sm hover:bg-blood-glow transition">
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
