"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

const PROMPTS = {
  stuck: "I am stuck",
  report: "Improve my report",
  rejected: "Explain feedback",
  commands: "Explain commands",
};

function guidanceFor({ mode, question, task, submission }) {
  const q = question.trim();
  const lines = [];
  lines.push(`Focus: ${PROMPTS[mode] || "Mentor guidance"}`);
  if (task) lines.push(`Task: Week ${task.week} - ${task.title}`);
  if (submission?.status) lines.push(`Current status: ${submission.status}`);
  if (submission?.feedback) lines.push(`Mentor feedback to address: ${submission.feedback}`);
  lines.push("");

  if (mode === "rejected") {
    lines.push("Use this repair checklist:");
    lines.push("1. Restate the requirement that was missed.");
    lines.push("2. Add exact reproduction steps, commands, screenshots, and observed output.");
    lines.push("3. Explain impact in plain language, then add remediation.");
    lines.push("4. Mention what changed from your previous version.");
  } else if (mode === "report") {
    lines.push("Use this report structure:");
    lines.push("1. Scope and objective");
    lines.push("2. Methodology");
    lines.push("3. Evidence with screenshots or logs");
    lines.push("4. Findings and impact");
    lines.push("5. Remediation");
    lines.push("6. Short conclusion");
  } else if (mode === "commands") {
    lines.push("For every command, document:");
    lines.push("1. Why it was used");
    lines.push("2. Exact command");
    lines.push("3. Important output");
    lines.push("4. What the output proves");
  } else {
    lines.push("Debug your blockage in this order:");
    lines.push("1. Confirm the task scope and target input.");
    lines.push("2. Check environment setup and tool versions.");
    lines.push("3. Capture the exact error or unexpected output.");
    lines.push("4. Try the smallest reproducible step.");
    lines.push("5. Ask an admin with the evidence, not just 'it does not work'.");
  }

  if (q) {
    lines.push("");
    lines.push("Based on your question:");
    lines.push(`- ${q}`);
    lines.push("- Turn this into one concrete next action, then update your report with the result.");
  }

  lines.push("");
  lines.push("Boundary: this assistant gives direction and report hygiene. It should not write or solve the task for you.");
  return lines.join("\n");
}

export default function MentorScreen({ me, onBack }) {
  const [tasks, setTasks] = useState([]);
  const [subs, setSubs] = useState({});
  const [taskId, setTaskId] = useState("");
  const [mode, setMode] = useState("stuck");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  // Self-serve mentor (Phase 12): knowledge-base search over the resource library (flag `self_serve_mentor`).
  const [kbOn, setKbOn] = useState(false);
  const [kbQuery, setKbQuery] = useState("");
  const [kbResults, setKbResults] = useState(null);
  const [kbBusy, setKbBusy] = useState(false);

  useEffect(() => {
    supabase.from("feature_flags").select("enabled").eq("key", "self_serve_mentor").maybeSingle()
      .then(({ data }) => setKbOn(!!data?.enabled)).catch(() => {});
  }, []);

  async function searchKb(e) {
    e.preventDefault();
    const q = kbQuery.trim();
    if (!q) { setKbResults(null); return; }
    setKbBusy(true);
    try {
      const { data } = await supabase.from("resources")
        .select("id,title,kind,url,r2_key,week")
        .eq("is_published", true)
        .textSearch("search", q, { type: "websearch", config: "english" })
        .limit(8);
      setKbResults(data || []);
    } catch { setKbResults([]); }
    setKbBusy(false);
  }

  useEffect(() => {
    let stop = false;
    Promise.all([
      supabase.from("tasks").select("id,week,title,description,due_at").order("week", { ascending: true }),
      supabase.from("submissions").select("task_id,status,feedback,graded_at").eq("user_id", me.id),
    ]).then(([{ data: t }, { data: s }]) => {
      if (stop) return;
      setTasks(t || []);
      const map = {};
      (s || []).forEach((row) => { map[row.task_id] = row; });
      setSubs(map);
      setTaskId(String((t || [])[0]?.id || ""));
      setLoading(false);
    });
    return () => { stop = true; };
  }, [me.id]);

  const selected = useMemo(() => tasks.find((t) => String(t.id) === String(taskId)), [tasks, taskId]);
  const selectedSub = selected ? subs[selected.id] : null;

  function generate(e) {
    e.preventDefault();
    setAnswer(guidanceFor({ mode, question, task: selected, submission: selectedSub }));
    try { supabase.rpc("log_my_activity", { p_type: "mentor_used", p_meta: { task_id: selected?.id, mode } }); } catch {}
  }

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Mentor assistant</h1>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            Back
          </button>
        </div>
      </header>

      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 font-mono grid lg:grid-cols-[minmax(0,420px),1fr] gap-6">
        <form onSubmit={generate} className="border border-blood/20 rounded-sm bg-ink-900/35 p-4 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">Task context</label>
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)} className="w-full panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm text-sm">
              {loading ? <option>Loading...</option> : tasks.map((t) => <option key={t.id} value={t.id}>Week {t.week} - {t.title}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(PROMPTS).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setMode(key)} className={`border rounded-sm px-3 py-2 text-[11px] uppercase tracking-widest transition ${mode === key ? "border-blood bg-blood/15 text-white" : "border-neutral-800 text-neutral-400 hover:border-neutral-600"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={6} maxLength={1200}
            placeholder="Describe where you are stuck, paste mentor feedback, or list commands you do not understand..."
            className="w-full panel border border-blood/30 focus:border-blood outline-none rounded-sm px-3 py-2 text-sm text-neutral-100 resize-none" />
          <button className="btn-neon text-xs uppercase tracking-widest px-4 py-2 rounded-sm">Generate guidance</button>
        </form>

        <section className="border border-blood/20 rounded-sm bg-ink-900/25 p-4 min-h-[24rem]">
          {kbOn && (
            <div className="mb-4 border-b border-neutral-800 pb-4">
              <div className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Search the knowledge base</div>
              <form onSubmit={searchKb} className="flex gap-2">
                <input value={kbQuery} onChange={(e) => setKbQuery(e.target.value)} placeholder="e.g. burp intruder, nmap flags…"
                  className="flex-1 panel border border-blood/30 focus:border-blood outline-none rounded-sm px-3 py-2 text-sm text-neutral-100" />
                <button className="btn-neon text-xs uppercase tracking-widest px-3 py-2 rounded-sm">{kbBusy ? "…" : "Search"}</button>
              </form>
              {kbResults && (kbResults.length === 0 ? (
                <p className="text-xs text-neutral-500 mt-3">No matching resources. Try different words, or ask an admin / book office hours.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {kbResults.map((r) => (
                    <li key={r.id} className="text-sm">
                      {r.url
                        ? <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-[#38bdf8] hover:underline">{r.title}</a>
                        : <span className="text-neutral-200">{r.title}</span>}
                      <span className="text-neutral-600 text-[11px]"> · {r.kind}{r.week != null ? ` · wk ${r.week}` : ""}{r.r2_key && !r.url ? " · in Resources" : ""}</span>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          )}
          {selected && (
            <div className="mb-4 border-b border-neutral-800 pb-3">
              <div className="text-blood text-[10px] uppercase tracking-widest">Week {selected.week}</div>
              <h2 className="text-white text-lg">{selected.title}</h2>
              {selectedSub?.status && <p className="text-xs text-neutral-500 mt-1">Submission: {selectedSub.status}</p>}
            </div>
          )}
          {answer ? (
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">{answer}</pre>
          ) : (
            <div className="text-sm text-neutral-500 leading-relaxed">
              Choose a task and mode, then generate guidance. This screen is intentionally bounded: it helps students plan, debug, and improve reports without producing final task answers.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
