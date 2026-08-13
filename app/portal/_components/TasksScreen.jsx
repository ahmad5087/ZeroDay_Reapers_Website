"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadToR2, downloadFromR2 } from "@/lib/r2client";
import { emailSelf } from "@/lib/notify";
import { fmtLocalAndPKT, submissionFilename } from "../_lib";
import { getTrack } from "./roadmaps";

const STATUS_STYLE = {
  submitted: "border-amber-500/50 text-amber-400",
  approved: "border-[#34d399]/50 text-[#34d399]",
  rejected: "border-blood/50 text-blood",
};

// Marks are numeric (allow 9.5); render without trailing zeros ("9.50" -> "9.5", "—" when unset).
const fmtMark = (v) => (v == null ? "—" : String(Number(v)));

function fileExt(name = "") {
  return (name.split(".").pop() || "").toLowerCase();
}

// PDF only. Filename convention is no longer the intern's concern — the file is auto-named from their
// identity + week on upload (see submissionFilename), so there are no naming warnings here.
function analyzeSubmissionFile(file) {
  const blockers = [];
  const warnings = [];
  const ext = fileExt(file?.name);
  const max = 25 * 1024 * 1024;

  if (!file) blockers.push("Choose a PDF file first.");
  if (file && ext !== "pdf") blockers.push("Only PDF submissions are accepted.");
  if (file?.size === 0) blockers.push("The selected file is empty.");
  if (file?.size > max) blockers.push("Submission is larger than 25MB. Compress it before uploading.");
  if (file && file.size < 20 * 1024) warnings.push("The file is very small. Make sure it includes evidence, screenshots, and explanation.");

  return { blockers, warnings };
}

function Roadmap({ steps, trackName, tasks, subs, exts }) {
  const now = Date.now();
  const byWeek = new Map();
  tasks.forEach((t) => {
    const week = Number(t.week);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(t);
  });
  return (
    <section className="mb-6 border border-blood/20 rounded-sm bg-ink-900/35 p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
        <div>
          <h2 className="font-mono text-sm uppercase tracking-widest text-white">Learning path</h2>
          <p className="font-mono text-[11px] text-neutral-500 mt-1">Your weekly mission track, tied to your published tasks and submissions.</p>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest border border-blood/40 text-blood rounded-sm px-2 py-1">{trackName}</span>
      </div>
      <div className="grid md:grid-cols-3 xl:grid-cols-6 gap-2">
        {steps.map((step) => {
          const weekTasks = byWeek.get(step.week) || [];
          const approved = weekTasks.some((t) => subs[t.id]?.status === "approved");
          const submitted = weekTasks.some((t) => subs[t.id]?.status === "submitted");
          const rejected = weekTasks.some((t) => subs[t.id]?.status === "rejected");
          const nextDue = weekTasks
            .map((t) => exts[t.id]?.status === "approved" && exts[t.id]?.extended_until ? exts[t.id].extended_until : t.due_at)
            .filter(Boolean)
            .sort((a, b) => new Date(a) - new Date(b))[0];
          const overdue = nextDue && new Date(nextDue).getTime() < now && !approved;
          const tone = approved ? "border-[#34d399]/50 text-[#34d399]" : rejected || overdue ? "border-blood/50 text-blood" : submitted ? "border-amber-500/50 text-amber-400" : weekTasks.length ? "border-[#38bdf8]/50 text-[#38bdf8]" : "border-neutral-800 text-neutral-500";
          const status = approved ? "approved" : rejected ? "needs changes" : overdue ? "overdue" : submitted ? "in review" : weekTasks.length ? "open" : "locked";
          return (
            <div key={step.week} className={`border rounded-sm p-3 bg-black/20 ${tone}`}>
              <div className="font-mono text-[10px] uppercase tracking-widest">Week {step.week}</div>
              <div className="font-mono text-sm text-white mt-1">{step.label}</div>
              <p className="text-[11px] text-neutral-500 leading-relaxed mt-1">{step.focus}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] uppercase tracking-widest">{status}</span>
                <span className="font-mono text-[10px] text-neutral-600">{weekTasks.length} task{weekTasks.length === 1 ? "" : "s"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PreflightChecklist() {
  return (
    <div className="mt-3 grid sm:grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-widest">
      <span className="border border-neutral-800 rounded-sm px-2.5 py-1.5 text-neutral-400">PDF only</span>
      <span className="border border-neutral-800 rounded-sm px-2.5 py-1.5 text-neutral-400">Max 25MB</span>
      <span className="border border-neutral-800 rounded-sm px-2.5 py-1.5 text-neutral-400">Auto-named on upload</span>
    </div>
  );
}

function downloadFeedbackReport(task, sub, me) {
  const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const total = sub.score_overall != null ? `${fmtMark(sub.score_overall)} / 40` : "Not scored";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Feedback - Week ${esc(task.week)}</title><style>
    body{font-family:Arial,sans-serif;max-width:760px;margin:40px auto;color:#111;line-height:1.5}
    h1{font-size:22px;margin:0 0 8px} .muted{color:#666;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:18px 0}
    .box{border:1px solid #ddd;padding:12px}.score{font-size:20px;font-weight:700}.feedback{white-space:pre-wrap;border-left:4px solid #e10600;padding-left:14px}
  </style></head><body>
    <h1>ZeroDay Reapers - Task Feedback</h1>
    <p class="muted">Student: ${esc(me.full_name || me.display_name)} | Task: Week ${esc(task.week)} - ${esc(task.title)} | Status: ${esc(sub.status)}</p>
    <div class="box"><div class="muted">Overall</div><div class="score">${esc(total)}</div></div>
    <div class="grid">
      <div class="box">Completeness<br><b>${esc(fmtMark(sub.score_completeness))}/10</b></div>
      <div class="box">Accuracy<br><b>${esc(fmtMark(sub.score_accuracy))}/10</b></div>
      <div class="box">Evidence<br><b>${esc(fmtMark(sub.score_evidence))}/10</b></div>
      <div class="box">Report quality<br><b>${esc(fmtMark(sub.score_report))}/10</b></div>
    </div>
    <h2>Mentor Feedback</h2>
    <p class="feedback">${esc(sub.feedback || "No written feedback provided.")}</p>
  </body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `zdr-feedback-week-${task.week}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function TasksScreen({ me, onBack }) {
  const isAdmin = me?.role === "admin";
  const [tasks, setTasks] = useState([]);
  const [subs, setSubs] = useState({}); // task_id -> submission
  const [busy, setBusy] = useState(null); // task_id being uploaded
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(true);
  const [versions, setVersions] = useState(null); // { taskId, files } — version-history modal
  const [exts, setExts] = useState({}); // task_id -> latest extension request
  const [extModal, setExtModal] = useState(null); // { taskId } — extra-time request modal (no browser popup)
  const [extReason, setExtReason] = useState("");

  async function load() {
    const { data: t } = await supabase.from("tasks").select("*").order("week", { ascending: true });
    const { data: s } = await supabase.from("submissions").select("*").eq("user_id", me.id);
    const map = {};
    (s || []).forEach((row) => { map[row.task_id] = row; });
    // Latest extension request per task (newest first → first seen wins).
    const { data: ext } = await supabase.from("task_extension_requests")
      .select("*").eq("user_id", me.id).order("created_at", { ascending: false });
    const emap = {};
    (ext || []).forEach((r) => { if (!(r.task_id in emap)) emap[r.task_id] = r; });
    setTasks(t || []);
    setSubs(map);
    setExts(emap);
    setLoading(false);
  }
  useEffect(() => { if (!isAdmin) load(); }, []);

  // Admins don't submit tasks — they manage them in the Admin Panel.
  if (isAdmin) {
    return (
      <div className="min-h-screen flex flex-col bg-black text-white p-6 items-center justify-center font-mono">
        <div className="max-w-md text-center p-6 border border-blood/30 bg-ink-950/80 rounded-sm space-y-4">
          <h2 className="text-base font-bold tracking-widest text-white">ADMIN TASK MANAGEMENT</h2>
          <p className="text-xs text-neutral-400 leading-relaxed">
            As an Admin, you do not submit tasks. Task creation and review of all student uploads are handled directly inside your <span className="text-blood font-bold">Admin Panel</span> under the <span className="text-white font-bold">TASKS</span> and <span className="text-white font-bold">SUBMISSIONS</span> tabs.
          </p>
          <button onClick={onBack} className="w-full btn-neon font-bold px-4 py-2.5 text-xs uppercase tracking-widest rounded-sm hover:bg-blood-glow transition shadow-md">
            ← Return to Portal / Admin Panel
          </button>
        </div>
      </div>
    );
  }

  async function upload(taskId, file) {
    if (!file) return;
    const task = tasks.find((t) => t.id === taskId);
    const preflight = analyzeSubmissionFile(file);
    if (preflight.blockers.length) {
      setOk("");
      setErr(`Preflight failed: ${preflight.blockers.join(" ")}`);
      return;
    }
    setErr("");
    const warnNote = preflight.warnings.length ? ` Note: ${preflight.warnings.join(" ")}` : "";
    setOk(preflight.warnings.length ? `Preflight warning:${warnNote}` : "Preflight passed. Uploading...");
    setBusy(taskId);
    try {
      const { key } = await uploadToR2(file, { kind: "task", taskId });
      // Auto-name from the intern's identity + week (the uploaded filename is ignored), so admins/founders
      // always download a consistent "<Name> <MemberID> Week N.pdf".
      const savedName = submissionFilename({ name: me.display_name || me.full_name, memberId: me.member_id, week: task?.week });
      const { data: subRow, error } = await supabase.from("submissions").upsert(
        { task_id: taskId, user_id: me.id, file_path: key, file_name: savedName, submitted_at: new Date().toISOString() },
        { onConflict: "task_id,user_id" }
      ).select("id").single();
      if (error) throw new Error(error.message);
      // Record this attempt in the version history (no-op until 018 migration is applied).
      await supabase.from("submission_files").insert({
        submission_id: subRow?.id, task_id: taskId, user_id: me.id, file_path: key, file_name: savedName,
      });
      load();
      // Keep any preflight warnings on the success line instead of letting them flash past; only
      // auto-dismiss the clean success message.
      setOk(`Submission uploaded successfully ✓${warnNote}`);
      if (!warnNote) setTimeout(() => setOk(""), 4000);
      emailSelf("Submission received — ZeroDay Reapers", "<p>We received your submission — it's now pending mentor review. — ZeroDay Reapers</p>");
      supabase.rpc("log_my_activity", { p_type: "submission_created", p_meta: { task_id: taskId, week: tasks.find((t) => t.id === taskId)?.week } });
    } catch (e) {
      // Server-side gate (protect_submission, 067): an approved submission is locked and can't be
      // replaced. Pending/rejected submissions re-upload freely.
      setErr(/SUBMISSION_APPROVED_LOCKED/.test(e.message)
        ? "This week's submission has been approved — it's locked and can no longer be changed."
        : e.message);
    } finally {
      setBusy(null);
    }
  }

  async function download(key, name, opts) {
    try { await downloadFromR2(key, name, opts); } catch (e) { setErr(e.message); }
  }
  // Canonical download name for one of MY submissions (dupIndex disambiguates version-history attempts).
  function myFileName(week, dupIndex) {
    return submissionFilename({ name: me.display_name || me.full_name, memberId: me.member_id, week, dupIndex });
  }

  async function openVersions(taskId) {
    const { data } = await supabase.from("submission_files")
      .select("*").eq("task_id", taskId).eq("user_id", me.id)
      .order("uploaded_at", { ascending: false });
    setVersions({ taskId, files: data || [] });
  }

  function requestExtension(taskId) {
    setErr("");
    setExtReason("");
    setExtModal({ taskId });
  }
  async function submitExtension() {
    if (!extModal) return;
    setErr("");
    const { error } = await supabase.from("task_extension_requests")
      .insert({ task_id: extModal.taskId, user_id: me.id, reason: extReason.trim() || null });
    setExtModal(null);
    if (error) return setErr(
      /SUBMISSION_APPROVED_LOCKED/.test(error.message)
        ? "This week's submission has been approved — it's locked, so extra-time requests are closed."
        : error.message
    );
    load();
  }

  // Program progress: 6 approved submissions completes the internship (→ Alumni).
  const GOAL = 6;
  const track = getTrack(me);
  const approvedCount = Object.values(subs).filter((s) => s?.status === "approved").length;
  const pct = Math.min(100, Math.round((approvedCount / GOAL) * 100));
  const remaining = Math.max(0, GOAL - approvedCount);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-black/60 backdrop-blur-xl border-b border-blood/25">
        <div className="w-full flex items-center justify-between px-4 sm:px-6 py-3">
          <span className="font-mono text-sm tracking-widest text-white text-glow">MY TASKS</span>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back to chat
          </button>
        </div>
      </header>

      <div className="w-full px-4 sm:px-6 lg:px-8 py-8">
        {err && <p className="font-mono text-sm text-blood mb-4">{err}</p>}
        {ok && <p className="font-mono text-sm text-[#34d399] mb-4">{ok}</p>}
        {loading ? (
          <p className="font-mono text-xs text-neutral-500 animate-pulse">Loading tasks…</p>
        ) : tasks.length === 0 ? (
          <p className="font-mono text-sm text-neutral-500">No tasks published yet — the Reapers are sharpening the blades. Check back soon.</p>
        ) : (
          <>
            <div className="mb-6 border border-blood/20 rounded-sm p-4 bg-ink-900/40">
              <div className="flex items-center justify-between font-mono text-xs uppercase tracking-widest mb-2">
                <span className="text-neutral-400">Internship progress</span>
                <span className="text-blood">{approvedCount}/{GOAL} approved</span>
              </div>
              <div className="h-2 w-full bg-ink-800 rounded-sm overflow-hidden border border-blood/20">
                <div className="h-full bg-blood transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              {approvedCount >= GOAL ? (
                <p className="mt-2 font-mono text-[11px] text-[#34d399]">All {GOAL} tasks approved — you're eligible to graduate to Alumni. 🎓</p>
              ) : (
                <p className="mt-2 font-mono text-[11px] text-neutral-500">{remaining} more approved {remaining === 1 ? "task" : "tasks"} to complete the program.</p>
              )}
            </div>
            <Roadmap steps={track.steps} trackName={track.name} tasks={tasks} subs={subs} exts={exts} />
            <div className="space-y-4">
            {tasks.map((t) => {
              const sub = subs[t.id];
              const ext = exts[t.id];
              const grantedUntil = ext?.status === "approved" && ext.extended_until ? ext.extended_until : null;
              const effectiveDue = grantedUntil || t.due_at;
              const overdue = effectiveDue && new Date(effectiveDue) < new Date() && (!sub || sub.status !== "approved");
              const earlierTasks = tasks.filter((prev) => Number(prev.week) < Number(t.week));
              // Gate later weeks only when an earlier week is untouched or was rejected. A week that's
              // already submitted (awaiting review) or approved unlocks the next one, so students can keep
              // working while a mentor reviews rather than stalling on review turnaround / deadline windows.
              const prereqLocked = earlierTasks.some((prev) => {
                const st = subs[prev.id]?.status;
                return st !== "approved" && st !== "submitted";
              });
              // Approved is final: once a mentor approves the week, it's locked for the intern — no new
              // version and no extra-time request (server-enforced in protect_submission, 067). A pending
              // or rejected ("needs changes") submission stays freely re-uploadable.
              const approvedLocked = sub?.status === "approved";
              // Once the deadline passes, uploads lock. A pending extension request is NOT enough — a
              // founder must APPROVE it, which pushes effectiveDue out via extended_until and re-opens
              // uploads until that granted window also lapses.
              const deadlinePassed = effectiveDue && new Date(effectiveDue) < new Date();
              const submitLocked = deadlinePassed;
              // Prereqs only gate STARTING a new week; a week you've already submitted stays editable.
              const prereqBlocked = prereqLocked && !sub;
              const canUpload = !approvedLocked && !submitLocked && !prereqBlocked;
              return (
                <article key={t.id} className="border border-blood/20 rounded-sm p-5 bg-ink-900/40">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono text-xs uppercase tracking-widest text-blood mb-1">Week {t.week}</div>
                      <h3 className="font-mono text-lg text-white">{t.title}</h3>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.ram && (
                        <span className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-sm border border-cyan-500/40 text-cyan-300" title="Recommended system RAM for this task">
                          {t.ram}
                        </span>
                      )}
                      {sub && (
                        <span className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-sm border ${STATUS_STYLE[sub.status] || ""}`}>
                          {sub.status}
                        </span>
                      )}
                    </div>
                  </div>

                  {t.file_path && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => downloadFromR2(t.file_path)}
                        className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest panel border border-blood/40 text-blood px-3.5 py-2 rounded-sm hover:border-blood hover:bg-ink-800 transition shadow-sm"
                      >
                        <span>📄</span>
                        <span>Download Task PDF ({t.file_name || "Instructions"})</span>
                      </button>
                    </div>
                  )}

                  {t.description && <p className="mt-3 text-sm text-neutral-400 whitespace-pre-wrap leading-relaxed">{t.description}</p>}
                  <PreflightChecklist />

                  {t.created_at && (
                    <p className="mt-2 font-mono text-xs text-neutral-500">Posted {fmtLocalAndPKT(t.created_at)}</p>
                  )}
                  {t.due_at && (
                    <p className={`mt-1 font-mono text-xs ${overdue ? "text-blood" : "text-neutral-500"}`}>
                      Due {fmtLocalAndPKT(effectiveDue)}
                      {grantedUntil ? " (extended)" : ""}{overdue ? " · overdue" : ""}
                    </p>
                  )}
                  {ext && (
                    <p className="mt-1 font-mono text-xs">
                      {ext.status === "pending" && <span className="text-amber-400">⏳ Extra time requested — pending review</span>}
                      {ext.status === "approved" && <span className="text-[#34d399]">✓ Extension granted{ext.extended_until ? ` until ${fmtLocalAndPKT(ext.extended_until)}` : ""}</span>}
                      {ext.status === "rejected" && <span className="text-blood">✗ Extra-time request declined</span>}
                    </p>
                  )}

                  {sub?.feedback && (
                    <div className="mt-3 border-l-2 border-blood/40 pl-3">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Mentor feedback</div>
                      <p className="text-sm text-neutral-300">{sub.feedback}</p>
                    </div>
                  )}

                  {sub && sub.score_overall != null && (
                    <div className="mt-3 border border-blood/20 rounded-sm p-3 bg-ink-900/40">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Marks</span>
                        <span className="font-mono text-sm font-bold text-white">
                          {fmtMark(sub.score_overall)}<span className="text-neutral-600"> / 40</span>
                          <span className="text-[#34d399] ml-2">{Math.round((Number(sub.score_overall) / 40) * 100)}%</span>
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-neutral-400">
                        <span className="flex justify-between gap-2"><span>Completeness</span><span className="text-neutral-200">{fmtMark(sub.score_completeness)}/10</span></span>
                        <span className="flex justify-between gap-2"><span>Accuracy</span><span className="text-neutral-200">{fmtMark(sub.score_accuracy)}/10</span></span>
                        <span className="flex justify-between gap-2"><span>Evidence</span><span className="text-neutral-200">{fmtMark(sub.score_evidence)}/10</span></span>
                        <span className="flex justify-between gap-2"><span>Report quality</span><span className="text-neutral-200">{fmtMark(sub.score_report)}/10</span></span>
                      </div>
                    </div>
                  )}

                  {sub?.graded_at && (
                    <button onClick={() => downloadFeedbackReport(t, sub, me)} className="mt-3 font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
                      Download feedback report
                    </button>
                  )}

                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    {canUpload ? (
                      <label className="cursor-pointer font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm hover:bg-blood-glow transition">
                        <input type="file" accept=".pdf,application/pdf" className="hidden"
                          onChange={(e) => upload(t.id, e.target.files?.[0])} disabled={busy === t.id} />
                        {busy === t.id ? "Uploading…" : !sub ? "Upload submission" : "Replace submission"}
                      </label>
                    ) : approvedLocked ? (
                      <span title="Approved by a mentor — this week is locked: no new versions or extra-time requests." className="font-mono text-xs uppercase tracking-widest border border-[#34d399]/50 text-[#34d399] px-4 py-2 rounded-sm">
                        ✓ Approved — submission locked
                      </span>
                    ) : prereqBlocked ? (
                      <span className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-400 px-4 py-2 rounded-sm" title="Submit your earlier weeks first.">
                        Locked - submit earlier weeks first
                      </span>
                    ) : submitLocked ? (
                      <span className="font-mono text-xs uppercase tracking-widest border border-blood/50 text-blood px-4 py-2 rounded-sm" title="The deadline for this task has passed. Request extra time to re-open your submission.">
                        🔒 Deadline passed — submissions closed
                      </span>
                    ) : null}
                    {canUpload && <span className="font-mono text-[10px] text-neutral-600">{sub ? "Re-upload freely until it's approved · PDF only" : "PDF only · auto-named on upload"}</span>}
                    {sub?.file_path && (
                      <button onClick={() => download(sub.file_path, myFileName(t.week), { inline: true })} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition">
                        View my file
                      </button>
                    )}
                    {sub?.file_name && <span className="font-mono text-xs text-neutral-600 truncate max-w-[200px]">{sub.file_name}</span>}
                    {sub && (
                      <button onClick={() => openVersions(t.id)} className="font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-blood transition">
                        Version history
                      </button>
                    )}
                    {(!sub || sub.status !== "approved") && (!ext || ext.status === "rejected") && (
                      <button onClick={() => requestExtension(t.id)} className="font-mono text-xs uppercase tracking-widest border border-amber-500/50 text-amber-400 px-4 py-2 rounded-sm hover:bg-amber-500/10 hover:border-amber-400 transition">
                        {ext?.status === "rejected" ? "⏳ Request time again" : "⏳ Request extra time"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
            </div>
          </>
        )}
      </div>

      {versions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setVersions(null)}>
          <div className="w-full max-w-md border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-sm uppercase tracking-widest text-white">Version history</h3>
              <button onClick={() => setVersions(null)} className="font-mono text-xs text-neutral-500 hover:text-blood">✕</button>
            </div>
            {versions.files.length === 0 ? (
              <p className="font-mono text-xs text-neutral-500">No previous versions recorded.</p>
            ) : (
              <ul className="space-y-2 max-h-72 overflow-y-auto">
                {versions.files.map((f, i) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 border border-blood/20 rounded-sm px-3 py-2">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-neutral-200 truncate">{f.file_name || "file"}</div>
                      <div className="font-mono text-[10px] text-neutral-500">
                        {i === 0 ? "latest · " : ""}{fmtLocalAndPKT(f.uploaded_at)}
                      </div>
                    </div>
                    <button onClick={() => download(f.file_path, myFileName(tasks.find((t) => t.id === versions.taskId)?.week, versions.files.length - 1 - i), { inline: true })} className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-blood hover:text-blood transition shrink-0">
                      Preview
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {extModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setExtModal(null)}>
          <div className="w-full max-w-md border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-mono text-sm uppercase tracking-widest text-white">Request extra time</h3>
              <button onClick={() => setExtModal(null)} className="font-mono text-xs text-neutral-500 hover:text-blood">✕</button>
            </div>
            <p className="font-mono text-[11px] text-neutral-500">Briefly, why do you need more time? (optional)</p>
            <textarea
              value={extReason}
              onChange={(e) => setExtReason(e.target.value)}
              rows={4}
              maxLength={500}
              placeholder="e.g. lab access was down / exams this week…"
              className="w-full panel border border-blood/30 focus:border-blood outline-none rounded-sm px-3 py-2 text-sm text-neutral-100 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setExtModal(null)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition">Cancel</button>
              <button onClick={submitExtension} className="font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm hover:bg-blood-glow transition">Send request</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
