"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { initials, colorFor } from "../_lib";
import { uploadToR2, downloadFromR2, deleteFromR2 } from "@/lib/r2client";

export default function AdminPanel({ onBack, me, setMe }) {
  const [domains, setDomains] = useState([]);
  const [members, setMembers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [ann, setAnn] = useState({ title: "", body: "" });
  const [name, setName] = useState(me?.display_name || "");
  const [tasks, setTasks] = useState([]);
  const [subs, setSubs] = useState([]);
  const [resumes, setResumes] = useState({}); // user_id -> {file_key,file_name}
  const [taskForm, setTaskForm] = useState({ domain_id: "", week: "", title: "", due_at: "" });
  const [taskFile, setTaskFile] = useState(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function loadMembers() {
    const { data } = await supabase.from("profiles")
      .select("id,display_name,email,role,banned,domain_id,timeout_until")
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
    const { data } = await supabase.from("submissions")
      .select("*, tasks(week,title), profiles(display_name)")
      .order("submitted_at", { ascending: false });
    setSubs(data || []);
  }

  async function loadResumes() {
    const { data } = await supabase.from("documents").select("user_id,file_key,file_name").eq("kind", "resume");
    const map = {};
    (data || []).forEach((d) => { map[d.user_id] = d; });
    setResumes(map);
  }

  useEffect(() => {
    supabase.from("domains").select("id,name,key").order("sort").then(({ data }) => setDomains(data || []));
    loadMembers();
    loadAnn();
    loadTasks();
    loadSubs();
    loadResumes();
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

      setTaskForm({ domain_id: "", week: "", title: "", due_at: "" });
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
  async function gradeSub(id, status) {
    setErr("");
    const fb = window.prompt(status === "approved" ? "Optional feedback:" : "Feedback (reason for rejection):") ?? "";
    const { error } = await supabase.from("submissions").update({
      status, feedback: fb.trim() || null, graded_by: me.id, graded_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) return setErr(error.message);
    loadSubs();
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
          <h2 className="font-mono text-xl text-white mb-4">Members ({members.length})</h2>
          <div className="overflow-x-auto border border-blood/20 rounded-sm">
            <table className="w-full text-sm font-mono">
              <thead className="bg-ink-900 text-neutral-500 uppercase text-xs tracking-widest">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Domain</th>
                  <th className="text-left px-4 py-3">Timeout</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-t border-blood/10">
                    <td className="px-4 py-3 text-white">
                      {m.display_name} {m.role === "admin" && <span className="text-blood text-xs">(admin)</span>}
                      {resumes[m.id] && (
                        <button onClick={() => downloadFromR2(resumes[m.id].file_key)} className="block text-[10px] uppercase tracking-widest text-blood hover:underline mt-0.5">
                          ▸ resume
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{m.email}</td>
                    <td className="px-4 py-3">
                      {m.role === "admin" ? (
                        <span className="text-blood uppercase text-xs tracking-widest">Admin</span>
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
                        <button onClick={() => setBan(m.id, false)} className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1.5 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">
                          Unban
                        </button>
                      ) : (
                        <button onClick={() => setBan(m.id, true)} className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1.5 rounded-sm hover:bg-blood hover:text-ink-950 transition">
                          Ban
                        </button>
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
          <h2 className="font-mono text-xl text-white mb-4">Submissions ({subs.length})</h2>
          <div className="overflow-x-auto border border-blood/20 rounded-sm">
            <table className="w-full text-sm font-mono">
              <thead className="bg-ink-900 text-neutral-500 uppercase text-xs tracking-widest">
                <tr>
                  <th className="text-left px-4 py-3">Student</th>
                  <th className="text-left px-4 py-3">Task</th>
                  <th className="text-left px-4 py-3">File</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Grade</th>
                </tr>
              </thead>
              <tbody>
                {subs.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-4 text-neutral-500">No submissions yet.</td></tr>
                ) : subs.map((s) => (
                  <tr key={s.id} className="border-t border-blood/10">
                    <td className="px-4 py-3 text-white">{s.profiles?.display_name || "—"}</td>
                    <td className="px-4 py-3 text-neutral-300">W{s.tasks?.week} · {s.tasks?.title}</td>
                    <td className="px-4 py-3">
                      {s.file_path
                        ? <button onClick={() => downloadSub(s.file_path)} className="text-blood hover:underline">{s.file_name || "download"}</button>
                        : <span className="text-neutral-600">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={s.status === "approved" ? "text-[#34d399]" : s.status === "rejected" ? "text-blood" : "text-amber-400"}>{s.status}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button onClick={() => gradeSub(s.id, "approved")} className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1.5 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">Approve</button>
                        <button onClick={() => gradeSub(s.id, "rejected")} className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1.5 rounded-sm hover:bg-blood hover:text-ink-950 transition">Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
