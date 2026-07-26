"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { initials, colorFor } from "../_lib";
import { uploadToR2, downloadFromR2, deleteFromR2 } from "@/lib/r2client";
import { notifyUser } from "@/lib/notify";

export default function AdminPanel({ onBack, me, setMe }) {
  const [domains, setDomains] = useState([]);
  const [members, setMembers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [ann, setAnn] = useState({ title: "", body: "" });
  const [name, setName] = useState(me?.display_name || "");
  const [tasks, setTasks] = useState([]);
  const [subs, setSubs] = useState([]);
  const [audit, setAudit] = useState([]);
  const [reports, setReports] = useState([]);
  const [subDomainFilter, setSubDomainFilter] = useState("");
  const [taskForm, setTaskForm] = useState({ domain_id: "", week: "", title: "", due_at: "", ram: "" });
  const [taskFile, setTaskFile] = useState(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function loadMembers() {
    const { data } = await supabase.from("profiles")
      .select("id,display_name,email,role,banned,domain_id,timeout_until,status,payment_proof_url,payment_proof_submitted_at,payment_confirmed,is_alumni,ram")
      .order("created_at", { ascending: true });
    setMembers(data || []);
  }
  async function loadAnn() {
    const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
    setAnnouncements(data || []);
  }

  async function loadTasks() {
    const { data } = await supabase.from("tasks").select("*, domains(name)").order("week", { ascending: true });
    setTasks(data || []);
  }
  async function loadSubs() {
    // submissions has TWO FKs to profiles (user_id, graded_by) — must disambiguate,
    // otherwise PostgREST returns PGRST201 and the whole query fails (no submissions shown).
    const { data, error } = await supabase.from("submissions")
      .select("*, tasks(week,title,domain_id), profiles!submissions_user_id_fkey(display_name,domain_id)")
      .order("submitted_at", { ascending: false });
    if (error) { setErr("Could not load submissions: " + error.message); return; }
    setSubs(data || []);
  }

  async function loadAudit() {
    const { data } = await supabase.from("admin_actions").select("*").order("created_at", { ascending: false }).limit(100);
    setAudit(data || []);
  }
  async function loadReports() {
    const { data } = await supabase.from("message_reports")
      .select("*, messages(content,user_id,domain_id,deleted)")
      .order("created_at", { ascending: false }).limit(100);
    setReports(data || []);
  }
  async function resolveReport(id) {
    await supabase.from("message_reports").update({ resolved: true }).eq("id", id);
    loadReports();
  }
  async function deleteReportedMessage(messageId, reportId) {
    await supabase.from("messages").update({ deleted: true }).eq("id", messageId);
    await supabase.from("message_reports").update({ resolved: true }).eq("id", reportId);
    loadReports();
  }

  useEffect(() => {
    supabase.from("domains").select("id,name,key").order("sort").then(({ data }) => setDomains(data || []));
    loadMembers();
    loadAnn();
    loadTasks();
    loadSubs();
    loadAudit();
    loadReports();
  }, []);

  async function setDomain(userId, domainId) {
    setErr("");
    const { error } = await supabase.rpc("admin_set_domain", { target: userId, new_domain: Number(domainId) });
    if (error) return setErr(error.message);
    loadMembers();
  }
  async function setBan(userId, isBanned) {
    setErr("");
    const { error } = await supabase.rpc("admin_set_ban", { target: userId, is_banned: isBanned });
    if (error) return setErr(error.message);
    loadMembers();
  }
  async function setTimeout_(userId, minutes) {
    setErr("");
    const { error } = await supabase.rpc("admin_set_timeout", { target: userId, minutes: Number(minutes) });
    if (error) return setErr(error.message);
    loadMembers();
  }
  async function setStatus(userId, newStatus) {
    setErr("");
    const { error } = await supabase.rpc("admin_set_status", { target: userId, new_status: newStatus });
    if (error) return setErr(error.message);
    loadMembers();
  }
  async function setRam(userId, newRam) {
    setErr("");
    const { error } = await supabase.rpc("admin_set_ram", { target: userId, new_ram: newRam });
    if (error) return setErr(error.message);
    loadMembers();
  }
  async function deleteMember(userId, displayName) {
    if (!window.confirm(`Are you sure you want to permanently delete account "${displayName}"? They will have to register again.`)) return;
    setErr("");
    const { error } = await supabase.rpc("admin_delete_user", { target_user_id: userId });
    if (error) return setErr(error.message);
    setOk(`Deleted account ${displayName}`);
    loadMembers();
  }
  async function auditUnpaid() {
    if (!window.confirm("⚠️ WEEK 4 AUDIT: This will permanently remove all intern accounts that have NOT submitted fee payment proof. Continue?")) return;
    setErr(""); setOk("");
    const { data, error } = await supabase.rpc("audit_unpaid_interns");
    if (error) return setErr(error.message);
    setOk(`Removed ${data || 0} unpaid intern account(s).`);
    loadMembers();
  }
  async function toggleAlumni(userId, graduated, name) {
    if (!window.confirm(graduated ? `🎓 Move ${name} to Alumni Group? They will lose access to previous domain groups and lobby.` : `Revoke Alumni status from ${name}?`)) return;
    setErr(""); setOk("");
    const { error } = await supabase.rpc("admin_set_alumni", { target: userId, graduated });
    if (error) return setErr(error.message);
    setOk(`Updated alumni status for ${name}.`);
    loadMembers();
  }
  async function toggleFeeConfirm(userId, confirmed, name) {
    setErr(""); setOk("");
    const { error } = await supabase.rpc("admin_set_payment_confirmed", { target: userId, confirmed });
    if (error) return setErr(error.message);
    setOk(confirmed ? `Fee confirmed for ${name}.` : `Fee confirmation revoked for ${name}.`);
    loadMembers();
  }
  async function cleanup75Days() {
    if (!window.confirm("🧹 75-DAY RETENTION CLEANUP: This will permanently delete all resumes, documents, task submissions, and chat messages older than 75 days for non-admin interns, while preserving their user accounts. Continue?")) return;
    setErr(""); setOk("Running 75-day cleanup...");
    const { data: expiredKeys, error } = await supabase.rpc("cleanup_75day_intern_data");
    if (error) return setErr(error.message);
    let deletedCount = 0;
    if (expiredKeys && expiredKeys.length > 0) {
      for (const key of expiredKeys) {
        if (key) {
          await deleteFromR2(key).catch(() => {});
          deletedCount++;
        }
      }
    }
    setOk(`🧹 Cleanup complete! Purged database records >75 days old and deleted ${deletedCount} archived R2 file(s).`);
    loadMembers(); loadSubs();
  }
  async function saveName() {
    setErr(""); setOk("");
    if (!name.trim() || !me) return;
    const { error } = await supabase.from("profiles").update({ display_name: name.trim() }).eq("id", me.id);
    if (error) return setErr(error.message);
    setMe?.((m) => ({ ...m, display_name: name.trim() }));
    setOk("Display name saved.");
  }
  async function uploadAvatar(e) {
    setErr(""); setOk("");
    const file = e.target.files?.[0];
    if (!file || !me) return;
    const ext = file.name.split(".").pop();
    const path = `${me.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) return setErr(upErr.message);
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
    const url = pub.publicUrl + "?t=" + Date.now();
    await supabase.from("profiles").update({ avatar_url: url }).eq("id", me.id);
    setMe?.((m) => ({ ...m, avatar_url: url }));
    setOk("Avatar updated.");
  }

  async function createTask(e) {
    e.preventDefault(); setErr(""); setOk("");
    if (!taskForm.week || !taskForm.title.trim()) return setErr("Week and title are required.");
    setTaskBusy(true);
    try {
      let file_path = null;
      let file_name = null;
      if (taskFile) {
        const uploaded = await uploadToR2(taskFile, { kind: "task-pdf", week: taskForm.week });
        file_path = uploaded.key;
        file_name = uploaded.name;
      }
      const domainId = taskForm.domain_id ? Number(taskForm.domain_id) : null;
      const { error } = await supabase.from("tasks").insert({
        domain_id: domainId,
        week: Number(taskForm.week),
        title: taskForm.title.trim(),
        file_path,
        file_name,
        ram: taskForm.ram || null,
        due_at: taskForm.due_at ? new Date(taskForm.due_at).toISOString() : null,
      });
      if (error) {
        setTaskBusy(false);
        return setErr(error.message);
      }

      if (domainId) {
        await supabase.from("messages").insert({
          domain_id: domainId,
          user_id: me.id,
          content: `📢 ANNOUNCEMENT: Week ${Number(taskForm.week)} Task is now live — "${taskForm.title.trim()}". Head over to your Tasks tab to download the attached PDF instructions and submit your deliverable!`,
        });
      } else {
        await supabase.from("announcements").insert({
          title: `Week ${Number(taskForm.week)} Task: ${taskForm.title.trim()}`,
          body: `A new task for Week ${Number(taskForm.week)} has been published for all departments. Check your Tasks tab to download the PDF instructions and submit your deliverable!`,
        });
      }

      setTaskForm({ domain_id: "", week: "", title: "", due_at: "", ram: "" });
      setTaskFile(null);
      setOk("Task created & announcement sent.");
      loadTasks();
    } catch (err) {
      setErr(err.message || "Failed to create task");
    } finally {
      setTaskBusy(false);
    }
  }
  async function deleteTask(task) {
    const id = typeof task === "object" ? task.id : task;
    const file_path = typeof task === "object" ? task.file_path : null;
    if (file_path) {
      await deleteFromR2(file_path).catch(() => {});
    }
    await supabase.from("tasks").delete().eq("id", id);
    loadTasks(); loadSubs();
  }
  async function gradeSub(sub, status) {
    setErr("");
    const fb = window.prompt(status === "approved" ? "Optional feedback:" : "Feedback (reason for rejection):") ?? "";
    const { error } = await supabase.from("submissions").update({
      status, feedback: fb.trim() || null, graded_by: me.id, graded_at: new Date().toISOString(),
    }).eq("id", sub.id);
    if (error) return setErr(error.message);
    loadSubs();
    // best-effort email to the student (no-op if Resend key isn't configured)
    const wk = sub.tasks?.week, title = sub.tasks?.title || "your task";
    const subject = `Task ${status === "approved" ? "approved ✅" : "needs changes"} — ZeroDay Reapers`;
    const html = `<p>Hi,</p><p>Your submission for <b>Week ${wk} · ${title}</b> was <b>${status}</b>.</p>`
      + (fb.trim() ? `<p><b>Mentor feedback:</b> ${fb.trim()}</p>` : "")
      + `<p>— ZeroDay Reapers</p>`;
    notifyUser(sub.user_id, subject, html);
  }
  async function downloadSub(key) {
    if (!key) return;
    try { await downloadFromR2(key); } catch (e) { setErr(e.message); }
  }

  async function postAnn(e) {
    e.preventDefault();
    setErr("");
    if (!ann.title.trim() || !ann.body.trim()) return;
    const { error } = await supabase.from("announcements").insert({ title: ann.title.trim(), body: ann.body.trim() });
    if (error) return setErr(error.message);
    setAnn({ title: "", body: "" });
    loadAnn();
  }
  async function delAnn(id) {
    await supabase.from("announcements").delete().eq("id", id);
    loadAnn();
  }

  const input = "bg-ink-900 border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-sm";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-black border-b border-blood/20">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <span className="font-mono text-sm tracking-widest text-white text-glow">ADMIN · ZERO<span className="text-blood">DAY</span> REAPERS</span>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back to chat
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
        {err && <p className="font-mono text-sm text-blood">{err}</p>}
        {ok && <p className="font-mono text-sm text-[#34d399]">{ok}</p>}

        {/* My profile */}
        {me && (
          <section>
            <h2 className="font-mono text-xl text-white mb-4">My Profile</h2>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="cursor-pointer shrink-0" title="Change avatar">
                <input type="file" accept="image/*" className="hidden" onChange={uploadAvatar} />
                {me.avatar_url ? (
                  <img src={me.avatar_url} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <div className="h-12 w-12 rounded-full flex items-center justify-center font-mono text-sm text-white"
                    style={{ background: colorFor(me.id || me.display_name || "") }}>
                    {initials(me.display_name)}
                  </div>
                )}
              </label>
              <input className={`${input} w-64`} value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
              <button onClick={saveName} className="bg-blood text-ink-950 font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition">
                Save
              </button>
              {me.email && <span className="font-mono text-xs text-neutral-600">{me.email} · admin</span>}
            </div>
          </section>
        )}

        {/* Members */}
        <section>
          {members.some((m) => m.status === "pending" && m.role !== "admin") && (
            <div className="mb-6 p-4 bg-amber-500/10 border border-amber-500/40 rounded-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-mono text-sm uppercase tracking-widest text-amber-400 font-bold flex items-center gap-2">
                  <span>⏳ Pending Account Approvals ({members.filter((m) => m.status === "pending" && m.role !== "admin").length})</span>
                </h3>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {members
                  .filter((m) => m.status === "pending" && m.role !== "admin")
                  .map((m) => (
                    <div key={m.id} className="bg-ink-900 border border-amber-500/30 p-3 rounded-sm flex flex-col justify-between gap-3">
                      <div>
                        <div className="font-mono text-sm text-white font-bold truncate">{m.display_name}</div>
                        <div className="font-mono text-xs text-neutral-400 truncate">{m.email}</div>
                      </div>
                      <div className="flex items-center gap-2 pt-2 border-t border-neutral-800">
                        <button
                          onClick={() => setStatus(m.id, "approved")}
                          className="flex-1 text-xs uppercase tracking-widest bg-[#34d399]/20 border border-[#34d399] text-[#34d399] py-1.5 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition font-bold"
                        >
                          Accept
                        </button>
                        <button
                          onClick={() => setStatus(m.id, "rejected")}
                          className="flex-1 text-xs uppercase tracking-widest bg-red-500/20 border border-red-500 text-red-400 py-1.5 rounded-sm hover:bg-red-500 hover:text-white transition"
                        >
                          Reject
                        </button>
                        <button
                          onClick={() => deleteMember(m.id, m.display_name)}
                          className="text-xs uppercase tracking-widest bg-neutral-800 border border-neutral-700 text-neutral-400 px-2.5 py-1.5 rounded-sm hover:border-red-500 hover:text-red-400 transition"
                          title="Delete Account"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-mono text-xl text-white">Members ({members.length})</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={cleanup75Days}
                className="font-mono text-xs uppercase tracking-widest bg-neutral-800 border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-[#38bdf8] hover:text-[#38bdf8] transition font-bold shadow-lg flex items-center gap-1.5"
              >
                <span>🧹 Clean Up 75+ Day Intern Data</span>
              </button>
              <button
                onClick={auditUnpaid}
                className="font-mono text-xs uppercase tracking-widest bg-amber-500/20 border border-amber-500 text-amber-300 px-4 py-2 rounded-sm hover:bg-amber-500 hover:text-ink-950 transition font-bold shadow-lg shadow-amber-500/10 flex items-center gap-1.5"
              >
                <span>⚡ Audit & Remove Unpaid Interns (Week 4)</span>
              </button>
            </div>
          </div>
          <div className="overflow-x-auto border border-blood/20 rounded-sm">
            <table className="w-full text-sm font-mono">
              <thead className="bg-ink-900 text-neutral-500 uppercase text-xs tracking-widest">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Domain</th>
                  <th className="text-left px-4 py-3">RAM</th>
                  <th className="text-left px-4 py-3">Timeout</th>
                  <th className="text-left px-4 py-3">Ban / Mute</th>
                  <th className="text-left px-4 py-3">Fee Payment</th>
                  <th className="text-left px-4 py-3">Approval</th>
                  <th className="text-left px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-t border-blood/10">
                    <td className="px-4 py-3 text-white">
                      {m.display_name} {m.is_alumni && <span className="text-[#38bdf8] ml-1" title="Alumni">🎓</span>} {m.role === "admin" && <span className="text-blood text-xs font-semibold">(admin)</span>}
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{m.email}</td>
                    <td className="px-4 py-3">
                      {m.role === "admin" ? (
                        <span className="text-blood uppercase text-xs tracking-widest font-semibold">Admin</span>
                      ) : (
                        <select className={input} value={m.domain_id || ""} onChange={(e) => setDomain(m.id, e.target.value)}>
                          <option value="" disabled>—</option>
                          {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.role === "admin" ? (
                        <span className="text-neutral-600 text-xs">—</span>
                      ) : (
                        <select className={input} value={m.ram || ""} onChange={(e) => setRam(m.id, e.target.value)}>
                          <option value="" disabled>—</option>
                          <option value="8GB">8GB</option>
                          <option value="16GB">16GB</option>
                          <option value="24GB">24GB</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.role === "admin" ? (
                        <span className="text-neutral-600 text-xs">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <select className={input} defaultValue="" onChange={(e) => { setTimeout_(m.id, e.target.value); e.target.value = ""; }}>
                            <option value="" disabled>Timeout…</option>
                            <option value="5">5 minutes</option>
                            <option value="10">10 minutes</option>
                            <option value="30">30 minutes</option>
                            <option value="60">1 hour</option>
                            <option value="360">6 hours</option>
                            <option value="1440">24 hours</option>
                            <option value="0">Clear timeout</option>
                          </select>
                          {m.timeout_until && new Date(m.timeout_until) > new Date() && (
                            <span className="text-[10px] text-blood">until {new Date(m.timeout_until).toLocaleString([], { timeStyle: "short", dateStyle: "short" })}</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.role === "admin" ? (
                        <span className="text-neutral-600 text-xs">—</span>
                      ) : m.banned ? (
                        <button onClick={() => setBan(m.id, false)} className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1.5 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition font-medium">
                          Unban
                        </button>
                      ) : (
                        <button onClick={() => setBan(m.id, true)} className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1.5 rounded-sm hover:bg-blood hover:text-ink-950 transition font-medium">
                          Ban
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.role === "admin" ? (
                        <span className="text-neutral-600 text-xs">—</span>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          {m.payment_proof_url ? (
                            <a
                              href={m.payment_proof_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider bg-[#34d399]/20 border border-[#34d399] text-[#34d399] px-2.5 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition font-bold"
                            >
                              <span>📄 Proof</span>
                              <span className="text-[9px]">↗</span>
                            </a>
                          ) : (
                            <span className="text-[11px] uppercase tracking-wider bg-red-500/10 border border-red-500/30 text-red-400 px-2 py-1 rounded-sm font-semibold">
                              No proof
                            </span>
                          )}
                          {m.payment_confirmed ? (
                            <button
                              onClick={() => toggleFeeConfirm(m.id, false, m.display_name)}
                              title="Fee confirmed — click to revoke"
                              className="text-[11px] uppercase tracking-wider bg-[#34d399] text-ink-950 border border-[#34d399] px-2.5 py-1 rounded-sm font-bold hover:opacity-80 transition"
                            >
                              ✓ Fee confirmed
                            </button>
                          ) : (
                            <button
                              onClick={() => toggleFeeConfirm(m.id, true, m.display_name)}
                              title="Confirm this student's fee payment"
                              className="text-[11px] uppercase tracking-wider border border-neutral-600 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-[#34d399] hover:text-[#34d399] transition font-semibold"
                            >
                              Confirm fee
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.role === "admin" ? (
                        <span className="text-blood uppercase text-xs tracking-widest font-semibold">Approved</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-sm uppercase tracking-wider font-semibold ${m.status === "pending" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30 animate-pulse" : m.status === "rejected" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-[#34d399]/20 text-[#34d399] border border-[#34d399]/30"}`}>
                            {m.status || "approved"}
                          </span>
                          {m.status !== "approved" && (
                            <button onClick={() => setStatus(m.id, "approved")} title="Approve member" className="text-[10px] uppercase tracking-widest bg-[#34d399]/20 border border-[#34d399] text-[#34d399] px-2 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition font-bold">
                              ✓
                            </button>
                          )}
                          {m.status !== "rejected" && (
                            <button onClick={() => setStatus(m.id, "rejected")} title="Reject member" className="text-[10px] uppercase tracking-widest bg-red-500/20 border border-red-500 text-red-400 px-2 py-1 rounded-sm hover:bg-red-500 hover:text-white transition font-bold">
                              ✕
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {m.role === "admin" ? (
                        <span className="text-neutral-600 text-xs">—</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleAlumni(m.id, !m.is_alumni, m.display_name)}
                            title={m.is_alumni ? "Revoke Alumni Status" : "Graduate to Alumni Group"}
                            className={`text-xs uppercase tracking-widest border px-3 py-1.5 rounded-sm transition font-medium ${m.is_alumni ? "border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8]" : "border-neutral-600 text-neutral-300 hover:border-[#38bdf8] hover:text-[#38bdf8]"}`}
                          >
                            {m.is_alumni ? "🎓 Alumni" : "Graduate 🎓"}
                          </button>
                          <button
                            onClick={() => deleteMember(m.id, m.display_name)}
                            title="Permanently delete account"
                            className="text-xs uppercase tracking-widest border border-red-600/70 text-red-400 px-3 py-1.5 rounded-sm hover:bg-red-600 hover:text-white transition font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Tasks */}
        <section>
          <h2 className="font-mono text-xl text-white mb-4">Tasks</h2>
          <form onSubmit={createTask} className="grid sm:grid-cols-2 gap-3 max-w-2xl mb-6">
            <select className={input} value={taskForm.domain_id} onChange={(e) => setTaskForm((f) => ({ ...f, domain_id: e.target.value }))}>
              <option value="">All domains</option>
              {domains.filter((d) => d.key !== "lobby").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <input className={input} type="number" min="1" max="52" placeholder="Week #" value={taskForm.week} onChange={(e) => setTaskForm((f) => ({ ...f, week: e.target.value }))} />
            <select className={`${input} sm:col-span-2`} value={taskForm.ram} onChange={(e) => setTaskForm((f) => ({ ...f, ram: e.target.value }))}>
              <option value="">All RAM tiers</option>
              <option value="8GB">8GB RAM only</option>
              <option value="16GB">16GB RAM only</option>
              <option value="24GB">24GB RAM only</option>
            </select>
            <input className={`${input} sm:col-span-2`} placeholder="Task title" value={taskForm.title} onChange={(e) => setTaskForm((f) => ({ ...f, title: e.target.value }))} />
            <div className="sm:col-span-2 flex items-center gap-3 flex-wrap border border-blood/20 rounded-sm p-3 bg-ink-900/40">
              <label className="cursor-pointer font-mono text-xs uppercase tracking-widest bg-neutral-800 border border-neutral-700 text-blood px-4 py-2 rounded-sm hover:border-blood transition">
                <input type="file" accept=".pdf,.zip,.doc,.docx,image/*" className="hidden" onChange={(e) => setTaskFile(e.target.files?.[0] || null)} />
                {taskFile ? "Change PDF / File" : "📎 Attach Task PDF"}
              </label>
              {taskFile ? (
                <div className="flex items-center gap-2 font-mono text-xs text-neutral-300">
                  <span>📄 {taskFile.name}</span>
                  <button type="button" onClick={() => setTaskFile(null)} className="text-neutral-500 hover:text-blood">✕</button>
                </div>
              ) : (
                <span className="font-mono text-xs text-neutral-500">No PDF attached yet (optional)</span>
              )}
            </div>
            <label className="font-mono text-xs text-neutral-500 flex flex-col gap-1 sm:col-span-1">
              Due date (optional)
              <input className={input} type="datetime-local" value={taskForm.due_at} onChange={(e) => setTaskForm((f) => ({ ...f, due_at: e.target.value }))} />
            </label>
            <div className="flex items-end sm:col-span-1 justify-end">
              <button disabled={taskBusy} className="bg-blood text-ink-950 font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
                {taskBusy ? "Creating…" : "Create task"}
              </button>
            </div>
          </form>
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-4 border border-blood/20 rounded-sm p-3">
                <div className="font-mono text-sm text-white flex items-center gap-2 flex-wrap">
                  <div>
                    <span className="text-blood">W{t.week}</span> · {t.title}
                    <span className="text-neutral-600"> · {t.domains?.name || "All domains"}</span>
                    <span className="text-[#38bdf8]"> · {t.ram || "All RAM"}</span>
                  </div>
                  {t.file_path && (
                    <button type="button" onClick={() => downloadFromR2(t.file_path)} className="text-xs bg-ink-900 border border-neutral-700 px-2 py-0.5 rounded text-blood hover:border-blood inline-flex items-center gap-1">
                      <span>📄</span>
                      <span className="max-w-[150px] truncate">{t.file_name || "PDF"}</span>
                    </button>
                  )}
                </div>
                <button onClick={() => deleteTask(t)} className="font-mono text-xs text-neutral-500 hover:text-blood shrink-0">delete</button>
              </div>
            ))}
          </div>
        </section>

        {/* Submissions */}
        <section>
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <h2 className="font-mono text-xl text-white">Submissions ({subs.length})</h2>
            <select
              className={input}
              value={subDomainFilter}
              onChange={(e) => setSubDomainFilter(e.target.value)}
            >
              <option value="">All Departments (Grouped)</option>
              {domains.filter((d) => d.key !== "lobby").map((d) => {
                const count = subs.filter((s) => (s.profiles?.domain_id || s.tasks?.domain_id) === d.id).length;
                return <option key={d.id} value={d.id}>{d.name} ({count})</option>;
              })}
            </select>
          </div>
          <div className="space-y-6">
            {domains
              .filter((d) => d.key !== "lobby" && (!subDomainFilter || String(d.id) === String(subDomainFilter)))
              .map((d) => {
                const domainSubs = subs.filter((s) => (s.profiles?.domain_id || s.tasks?.domain_id) === d.id);
                return (
                  <div key={d.id} className="border border-blood/20 rounded-sm overflow-hidden bg-ink-900/20">
                    <div className="bg-ink-900 px-4 py-3 border-b border-blood/20 flex items-center justify-between">
                      <h3 className="font-mono text-sm uppercase tracking-widest text-blood font-bold flex items-center gap-2">
                        <span>▸ {d.name}</span>
                        <span className="text-neutral-500 font-normal">({domainSubs.length})</span>
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm font-mono">
                        <thead className="bg-ink-900/60 text-neutral-500 uppercase text-xs tracking-widest border-b border-blood/10">
                          <tr>
                            <th className="text-left px-4 py-2.5">Student</th>
                            <th className="text-left px-4 py-2.5">Task</th>
                            <th className="text-left px-4 py-2.5">File</th>
                            <th className="text-left px-4 py-2.5">Status</th>
                            <th className="text-left px-4 py-2.5">Grade</th>
                          </tr>
                        </thead>
                        <tbody>
                          {domainSubs.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-4 text-neutral-500 text-xs italic">No submissions for {d.name}.</td></tr>
                          ) : domainSubs.map((s) => (
                            <tr key={s.id} className="border-t border-blood/10 hover:bg-ink-900/40 transition">
                              <td className="px-4 py-3 text-white">{s.profiles?.display_name || "—"}</td>
                              <td className="px-4 py-3 text-neutral-300">W{s.tasks?.week} · {s.tasks?.title}</td>
                              <td className="px-4 py-3">
                                {s.file_path
                                  ? <button onClick={() => downloadSub(s.file_path)} className="text-blood hover:underline inline-flex items-center gap-1"><span>📄</span><span>{s.file_name || "download"}</span></button>
                                  : <span className="text-neutral-600">—</span>}
                              </td>
                              <td className="px-4 py-3">
                                <span className={s.status === "approved" ? "text-[#34d399]" : s.status === "rejected" ? "text-blood" : "text-amber-400"}>{s.status}</span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex gap-2">
                                  <button onClick={() => gradeSub(s, "approved")} className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">Approve</button>
                                  <button onClick={() => gradeSub(s, "rejected")} className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1 rounded-sm hover:bg-blood hover:text-ink-950 transition">Reject</button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}

            {/* General / Unassigned Submissions */}
            {(() => {
              const assignedIds = new Set(domains.map((d) => d.id));
              const unassignedSubs = subs.filter((s) => !assignedIds.has(s.profiles?.domain_id) && !assignedIds.has(s.tasks?.domain_id));
              if (unassignedSubs.length === 0) return null;
              if (subDomainFilter) return null;
              return (
                <div className="border border-blood/20 rounded-sm overflow-hidden bg-ink-900/20">
                  <div className="bg-ink-900 px-4 py-3 border-b border-blood/20 flex items-center justify-between">
                    <h3 className="font-mono text-sm uppercase tracking-widest text-neutral-400 font-bold flex items-center gap-2">
                      <span>▸ General / Unassigned</span>
                      <span className="text-neutral-500 font-normal">({unassignedSubs.length})</span>
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm font-mono">
                      <thead className="bg-ink-900/60 text-neutral-500 uppercase text-xs tracking-widest border-b border-blood/10">
                        <tr>
                          <th className="text-left px-4 py-2.5">Student</th>
                          <th className="text-left px-4 py-2.5">Task</th>
                          <th className="text-left px-4 py-2.5">File</th>
                          <th className="text-left px-4 py-2.5">Status</th>
                          <th className="text-left px-4 py-2.5">Grade</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unassignedSubs.map((s) => (
                          <tr key={s.id} className="border-t border-blood/10 hover:bg-ink-900/40 transition">
                            <td className="px-4 py-3 text-white">{s.profiles?.display_name || "—"}</td>
                            <td className="px-4 py-3 text-neutral-300">W{s.tasks?.week} · {s.tasks?.title}</td>
                            <td className="px-4 py-3">
                              {s.file_path
                                ? <button onClick={() => downloadSub(s.file_path)} className="text-blood hover:underline inline-flex items-center gap-1"><span>📄</span><span>{s.file_name || "download"}</span></button>
                                : <span className="text-neutral-600">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <span className={s.status === "approved" ? "text-[#34d399]" : s.status === "rejected" ? "text-blood" : "text-amber-400"}>{s.status}</span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-2">
                                <button onClick={() => gradeSub(s, "approved")} className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">Approve</button>
                                <button onClick={() => gradeSub(s, "rejected")} className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1 rounded-sm hover:bg-blood hover:text-ink-950 transition">Reject</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </section>

        {/* Reported messages */}
        <section>
          <h2 className="font-mono text-xl text-white mb-4">
            Reports {reports.filter((r) => !r.resolved).length > 0 && <span className="text-blood">({reports.filter((r) => !r.resolved).length} open)</span>}
          </h2>
          {reports.length === 0 ? (
            <p className="font-mono text-xs text-neutral-600">No reports.</p>
          ) : (
            <div className="space-y-2">
              {reports.map((r) => (
                <div key={r.id} className={`border rounded-sm p-4 ${r.resolved ? "border-neutral-800 opacity-60" : "border-blood/30"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-neutral-500">
                        {r.reason ? `Reason: ${r.reason}` : "No reason given"} · {new Date(r.created_at).toLocaleString()}
                      </div>
                      <p className="text-sm text-neutral-200 mt-1 break-words">
                        {r.messages?.deleted ? <span className="italic text-neutral-600">message removed</span> : (r.messages?.content || "—")}
                      </p>
                    </div>
                    {!r.resolved && (
                      <div className="flex gap-2 shrink-0">
                        {!r.messages?.deleted && (
                          <button onClick={() => deleteReportedMessage(r.message_id, r.id)} className="font-mono text-[11px] uppercase tracking-widest border border-blood text-blood px-3 py-1.5 rounded-sm hover:bg-blood hover:text-ink-950 transition">Delete msg</button>
                        )}
                        <button onClick={() => resolveReport(r.id)} className="font-mono text-[11px] uppercase tracking-widest border border-neutral-600 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-[#34d399] hover:text-[#34d399] transition">Dismiss</button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Audit log */}
        <section>
          <h2 className="font-mono text-xl text-white mb-4">Audit Log</h2>
          {audit.length === 0 ? (
            <p className="font-mono text-xs text-neutral-600">No admin actions logged yet.</p>
          ) : (
            <div className="overflow-x-auto border border-blood/20 rounded-sm max-h-80 overflow-y-auto">
              <table className="w-full text-sm font-mono">
                <thead className="bg-ink-900 text-neutral-500 uppercase text-xs tracking-widest sticky top-0">
                  <tr>
                    <th className="text-left px-4 py-2">When</th>
                    <th className="text-left px-4 py-2">Admin</th>
                    <th className="text-left px-4 py-2">Action</th>
                    <th className="text-left px-4 py-2">Target</th>
                    <th className="text-left px-4 py-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id} className="border-t border-blood/10">
                      <td className="px-4 py-2 text-neutral-500 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                      <td className="px-4 py-2 text-neutral-300">{a.actor_name || "—"}</td>
                      <td className="px-4 py-2 text-blood">{a.action}</td>
                      <td className="px-4 py-2 text-neutral-300">{a.target_name || "—"}</td>
                      <td className="px-4 py-2 text-neutral-500">{a.detail || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Announcements */}
        <section>
          <h2 className="font-mono text-xl text-white mb-4">Announcements</h2>
          <form onSubmit={postAnn} className="space-y-3 max-w-xl mb-6">
            <input className={`${input} w-full`} placeholder="Title" value={ann.title} onChange={(e) => setAnn((a) => ({ ...a, title: e.target.value }))} />
            <textarea className={`${input} w-full`} rows={3} placeholder="Body" value={ann.body} onChange={(e) => setAnn((a) => ({ ...a, body: e.target.value }))} />
            <button className="bg-blood text-ink-950 font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition">
              Post announcement
            </button>
          </form>
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-4 border border-blood/20 rounded-sm p-4">
                <div>
                  <div className="font-mono text-white">{a.title}</div>
                  <div className="text-sm text-neutral-400">{a.body}</div>
                </div>
                <button onClick={() => delAnn(a.id)} className="font-mono text-xs text-neutral-500 hover:text-blood shrink-0">delete</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
