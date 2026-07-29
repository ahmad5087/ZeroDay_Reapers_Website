"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadToR2, downloadFromR2 } from "@/lib/r2client";
import { emailSelf } from "@/lib/notify";

const STATUS_STYLE = {
  submitted: "border-amber-500/50 text-amber-400",
  approved: "border-[#34d399]/50 text-[#34d399]",
  rejected: "border-blood/50 text-blood",
};

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
          <button onClick={onBack} className="w-full bg-blood text-ink-950 font-bold px-4 py-2.5 text-xs uppercase tracking-widest rounded-sm hover:bg-blood-glow transition shadow-md">
            ← Return to Portal / Admin Panel
          </button>
        </div>
      </div>
    );
  }

  async function upload(taskId, file) {
    if (!file) return;
    setErr(""); setOk(""); setBusy(taskId);
    try {
      const { key, name } = await uploadToR2(file, { kind: "task", taskId });
      const { data: subRow, error } = await supabase.from("submissions").upsert(
        { task_id: taskId, user_id: me.id, file_path: key, file_name: name, submitted_at: new Date().toISOString() },
        { onConflict: "task_id,user_id" }
      ).select("id").single();
      if (error) throw new Error(error.message);
      // Record this attempt in the version history (no-op until 018 migration is applied).
      await supabase.from("submission_files").insert({
        submission_id: subRow?.id, task_id: taskId, user_id: me.id, file_path: key, file_name: name,
      });
      load();
      setOk("Submission uploaded successfully ✓");
      setTimeout(() => setOk(""), 4000);
      emailSelf("Submission received — ZeroDay Reapers", "<p>We received your submission — it's now pending mentor review. — ZeroDay Reapers</p>");
      supabase.rpc("log_my_activity", { p_type: "submission_created", p_meta: { task_id: taskId, week: tasks.find((t) => t.id === taskId)?.week } });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function download(key) {
    try { await downloadFromR2(key); } catch (e) { setErr(e.message); }
  }

  async function openVersions(taskId) {
    const { data } = await supabase.from("submission_files")
      .select("*").eq("task_id", taskId).eq("user_id", me.id)
      .order("uploaded_at", { ascending: false });
    setVersions({ taskId, files: data || [] });
  }

  async function requestExtension(taskId) {
    const reason = window.prompt("Request extra time for this task. Briefly, why? (optional)");
    if (reason === null) return; // cancelled
    setErr("");
    const { error } = await supabase.from("task_extension_requests")
      .insert({ task_id: taskId, user_id: me.id, reason: reason.trim() || null });
    if (error) return setErr(error.message);
    load();
  }

  // Program progress: 6 approved submissions completes the internship (→ Alumni).
  const GOAL = 6;
  const approvedCount = Object.values(subs).filter((s) => s?.status === "approved").length;
  const pct = Math.min(100, Math.round((approvedCount / GOAL) * 100));
  const remaining = Math.max(0, GOAL - approvedCount);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-black border-b border-blood/20">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-4 py-3">
          <span className="font-mono text-sm tracking-widest text-white text-glow">MY TASKS</span>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back to chat
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-8">
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
            <div className="space-y-4">
            {tasks.map((t) => {
              const sub = subs[t.id];
              const ext = exts[t.id];
              const grantedUntil = ext?.status === "approved" && ext.extended_until ? ext.extended_until : null;
              const effectiveDue = grantedUntil || t.due_at;
              const overdue = effectiveDue && new Date(effectiveDue) < new Date() && (!sub || sub.status !== "approved");
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
                        className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest bg-ink-900 border border-blood/40 text-blood px-3.5 py-2 rounded-sm hover:border-blood hover:bg-ink-800 transition shadow-sm"
                      >
                        <span>📄</span>
                        <span>Download Task PDF ({t.file_name || "Instructions"})</span>
                      </button>
                    </div>
                  )}

                  {t.description && <p className="mt-3 text-sm text-neutral-400 whitespace-pre-wrap leading-relaxed">{t.description}</p>}

                  {t.due_at && (
                    <p className={`mt-2 font-mono text-xs ${overdue ? "text-blood" : "text-neutral-500"}`}>
                      Due {new Date(effectiveDue).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      {grantedUntil ? " (extended)" : ""}{overdue ? " · overdue" : ""}
                    </p>
                  )}
                  {ext && (
                    <p className="mt-1 font-mono text-xs">
                      {ext.status === "pending" && <span className="text-amber-400">⏳ Extra time requested — pending review</span>}
                      {ext.status === "approved" && <span className="text-[#34d399]">✓ Extension granted{ext.extended_until ? ` until ${new Date(ext.extended_until).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}` : ""}</span>}
                      {ext.status === "rejected" && <span className="text-blood">✗ Extra-time request declined</span>}
                    </p>
                  )}

                  {sub?.feedback && (
                    <div className="mt-3 border-l-2 border-blood/40 pl-3">
                      <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Mentor feedback</div>
                      <p className="text-sm text-neutral-300">{sub.feedback}</p>
                    </div>
                  )}

                  <div className="mt-4 flex items-center gap-3 flex-wrap">
                    <label className="cursor-pointer font-mono text-xs uppercase tracking-widest bg-blood text-ink-950 px-4 py-2 rounded-sm hover:bg-blood-glow transition">
                      <input type="file" accept=".pdf,.zip,.doc,.docx,image/*" className="hidden"
                        onChange={(e) => upload(t.id, e.target.files?.[0])} disabled={busy === t.id} />
                      {busy === t.id ? "Uploading…" : sub ? "Replace submission" : "Upload submission"}
                    </label>
                    {sub?.file_path && (
                      <button onClick={() => download(sub.file_path)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition">
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
                      <button onClick={() => requestExtension(t.id)} className="font-mono text-xs uppercase tracking-widest text-neutral-500 hover:text-amber-400 transition">
                        {ext?.status === "rejected" ? "Request time again" : "Request extra time"}
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
                        {i === 0 ? "latest · " : ""}{new Date(f.uploaded_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                    </div>
                    <button onClick={() => download(f.file_path)} className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-blood hover:text-blood transition shrink-0">
                      Download
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
