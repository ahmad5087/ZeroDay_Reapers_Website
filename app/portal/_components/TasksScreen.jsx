"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadToR2, downloadFromR2 } from "@/lib/r2client";

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
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data: t } = await supabase.from("tasks").select("*").order("week", { ascending: true });
    const { data: s } = await supabase.from("submissions").select("*").eq("user_id", me.id);
    const map = {};
    (s || []).forEach((row) => { map[row.task_id] = row; });
    setTasks(t || []);
    setSubs(map);
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
    setErr(""); setBusy(taskId);
    try {
      const { key, name } = await uploadToR2(file, { kind: "task", taskId });
      const { error } = await supabase.from("submissions").upsert(
        { task_id: taskId, user_id: me.id, file_path: key, file_name: name, submitted_at: new Date().toISOString() },
        { onConflict: "task_id,user_id" }
      );
      if (error) throw new Error(error.message);
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function download(key) {
    try { await downloadFromR2(key); } catch (e) { setErr(e.message); }
  }

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
        {loading ? (
          <p className="font-mono text-xs text-neutral-500 animate-pulse">Loading tasks…</p>
        ) : tasks.length === 0 ? (
          <p className="font-mono text-sm text-neutral-500">No tasks published yet. Check back soon.</p>
        ) : (
          <div className="space-y-4">
            {tasks.map((t) => {
              const sub = subs[t.id];
              const overdue = t.due_at && new Date(t.due_at) < new Date() && (!sub || sub.status !== "approved");
              return (
                <article key={t.id} className="border border-blood/20 rounded-sm p-5 bg-ink-900/40">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="font-mono text-xs uppercase tracking-widest text-blood mb-1">Week {t.week}</div>
                      <h3 className="font-mono text-lg text-white">{t.title}</h3>
                    </div>
                    {sub && (
                      <span className={`font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded-sm border ${STATUS_STYLE[sub.status] || ""}`}>
                        {sub.status}
                      </span>
                    )}
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
                      Due {new Date(t.due_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{overdue ? " · overdue" : ""}
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
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
