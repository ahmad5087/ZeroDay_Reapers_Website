"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

export function ProfileScreen({ me, setMe, onBack }) {
  const [displayName, setDisplayName] = useState(me?.display_name || "");
  const [fullName, setFullName] = useState(me?.full_name || "");
  const [gender, setGender] = useState(me?.gender || "Male");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);

  async function handleSaveDetails(e) {
    e.preventDefault();
    setErr("");
    setOk("");
    if (!displayName.trim()) return setErr("Display name is required.");

    const updates = {
      display_name: displayName.trim(),
      full_name: fullName.trim() || null,
      gender: gender,
    };

    const { error } = await supabase.from("profiles").update(updates).eq("id", me.id);
    if (error) return setErr(error.message);

    setMe((m) => ({ ...m, ...updates }));
    setOk("Profile updated successfully!");
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
      const ext = file.name.split(".").pop();
      const path = `${me.id}/payment_proof_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
      if (upErr) throw upErr;

      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = pub.publicUrl + "?t=" + Date.now();
      const nowIso = new Date().toISOString();

      const { error: dbErr } = await supabase.from("profiles").update({
        payment_proof_url: url,
        payment_proof_submitted_at: nowIso,
      }).eq("id", me.id);
      if (dbErr) throw dbErr;

      setMe((m) => ({ ...m, payment_proof_url: url, payment_proof_submitted_at: nowIso }));
      setOk("🎉 Payment proof submitted successfully! Our admin team will review it.");
    } catch (err) {
      setErr(err.message || "Failed to upload payment proof.");
    } finally {
      setUploadingProof(false);
    }
  }

  const isAdmin = me?.role === "admin";
  const inputStyle = "w-full bg-ink-950 border border-blood/30 focus:border-blood outline-none px-4 py-2.5 text-neutral-100 rounded-sm font-mono text-sm";

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

        <div className="grid md:grid-cols-[280px_1fr] gap-8 items-start">
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
                  <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">Gender</label>
                  <select className={inputStyle} value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

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
                        <a
                          href={me.payment_proof_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs uppercase tracking-widest bg-[#34d399]/20 border border-[#34d399] text-[#34d399] px-4 py-2 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition font-bold inline-flex items-center gap-1.5"
                        >
                          <span>📄 View Uploaded Proof</span>
                          <span className="text-[10px]">↗</span>
                        </a>
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
          </div>
        </div>
      </main>
    </div>
  );
}
