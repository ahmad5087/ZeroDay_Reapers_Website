"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Intervention Case Management (Phase 1) — the admin surface over migration 070_risk_cases.sql.
// Turns the client-side "at-risk / Cohort Health" list into managed cases: assign a mentor, record
// outreach, keep PRIVATE staff notes, set a follow-up date, and resolve. Every mutation is a
// SECURITY DEFINER RPC (is_admin-gated + audit-logged); this component never writes tables directly.

const REASONS = [
  { id: "overdue_tasks", label: "Overdue tasks" },
  { id: "rejected_work", label: "Rejected work" },
  { id: "no_approved_work", label: "No approved work" },
  { id: "inactivity", label: "Inactivity" },
  { id: "unpaid_fee", label: "Unpaid fee" },
  { id: "late_comer", label: "Late comer" },
  { id: "other", label: "Other" },
];
const REASON_LABEL = Object.fromEntries(REASONS.map((r) => [r.id, r.label]));

const STATUS_META = {
  open:       { label: "Open",       tone: "text-blood border-blood/40",         dot: "bg-blood" },
  monitoring: { label: "Monitoring", tone: "text-amber-400 border-amber-500/40",  dot: "bg-amber-400" },
  resolved:   { label: "Resolved",   tone: "text-[#34d399] border-[#34d399]/40",  dot: "bg-[#34d399]" },
};
const SEVERITY_TONE = {
  low:    "text-neutral-400 border-neutral-700",
  medium: "text-amber-400 border-amber-500/40",
  high:   "text-blood border-blood/50",
};
const OUTREACH = [
  { id: "email", label: "Email" },
  { id: "dm", label: "DM" },
  { id: "call", label: "Call" },
  { id: "meeting", label: "Meeting" },
];
const EVENT_LABEL = {
  opened: "Case opened", status_change: "Status changed", mentor_assigned: "Mentor assigned",
  note_added: "Note added", follow_up_set: "Follow-up set", email: "Emailed", dm: "DMed",
  call: "Called", meeting: "Met", system: "System",
};

function rel(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}
function nameOf(p) {
  return p?.display_name || p?.full_name || (p?.member_id ? `#${p.member_id}` : "Intern");
}
function toLocalInput(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function InterventionsPanel({ me, members = [], refreshKey = 0, onOpenProfile }) {
  const input = "panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-sm";

  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  const [selected, setSelected] = useState(null);   // the case row open in the drawer
  const [events, setEvents] = useState([]);
  const [notes, setNotes] = useState([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [followInput, setFollowInput] = useState("");
  const [busy, setBusy] = useState(false);

  const mentors = useMemo(
    () => members.filter((m) => m.role === "admin").sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [members]
  );
  const grouped = useMemo(() => ({
    open:       cases.filter((c) => c.status === "open"),
    monitoring: cases.filter((c) => c.status === "monitoring"),
    resolved:   cases.filter((c) => c.status === "resolved"),
  }), [cases]);

  async function loadCases() {
    setLoading(true);
    const { data, error } = await supabase
      .from("risk_cases")
      .select("*, intern:profiles!risk_cases_intern_id_fkey(id,display_name,full_name,member_id,domain_id), mentor:profiles!risk_cases_mentor_id_fkey(id,display_name)")
      .order("opened_at", { ascending: false });
    if (error) setErr(error.message);
    setCases(data || []);
    setLoading(false);
  }
  useEffect(() => { loadCases(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadThread(caseId) {
    const [ev, nt] = await Promise.all([
      supabase.from("risk_case_events").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
      supabase.from("risk_case_notes").select("*").eq("case_id", caseId).order("created_at", { ascending: false }),
    ]);
    setEvents(ev.data || []);
    setNotes(nt.data || []);
  }
  async function openDrawer(c) {
    setSelected(c);
    setNoteText("");
    setFollowInput(toLocalInput(c.follow_up_at));
    setErr(""); setOk("");
    setDrawerLoading(true);
    await loadThread(c.id);
    setDrawerLoading(false);
  }
  function closeDrawer() { setSelected(null); setEvents([]); setNotes([]); }

  // Run an RPC, surface errors, then reload the board + the open thread.
  async function run(rpc, args, okMsg, patch) {
    if (!selected) return false;
    setErr(""); setOk(""); setBusy(true);
    const { error } = await supabase.rpc(rpc, args);
    setBusy(false);
    if (error) { setErr(error.message); return false; }
    if (okMsg) setOk(okMsg);
    if (patch) setSelected((s) => (s ? { ...s, ...patch } : s));
    await Promise.all([loadCases(), loadThread(selected.id)]);
    return true;
  }

  const addNote = async () => {
    if (!noteText.trim()) return;
    if (await run("add_case_note", { p_case: selected.id, p_body: noteText.trim() }, "Note added.")) setNoteText("");
  };
  const logOutreach = (kind)     => run("log_case_outreach",  { p_case: selected.id, p_kind: kind, p_detail: null }, `Logged ${kind}.`);
  const assignMentor= (mentorId) => run("assign_case_mentor", { p_case: selected.id, p_mentor: mentorId || null }, "Mentor updated.", { mentor_id: mentorId || null });
  const setStatus   = (status)   => run("set_case_status",    { p_case: selected.id, p_status: status, p_resolution: null }, `Marked ${status}.`, { status });
  const setFollowUp = () => run("set_case_follow_up", { p_case: selected.id, p_when: followInput ? new Date(followInput).toISOString() : null }, "Follow-up set.", { follow_up_at: followInput ? new Date(followInput).toISOString() : null });

  const btnGhost = "font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-blood hover:text-blood transition disabled:opacity-50";

  function CaseCard({ c }) {
    const st = STATUS_META[c.status] || STATUS_META.open;
    return (
      <button type="button" onClick={() => openDrawer(c)}
        className="w-full text-left border border-blood/20 rounded-sm bg-ink-900/30 hover:bg-ink-900/60 transition p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-sm text-white truncate">{nameOf(c.intern)} <span className="text-neutral-600">- {c.intern?.member_id || "no id"}</span></span>
          <span className={`font-mono text-[9px] uppercase tracking-widest border px-1.5 py-0.5 rounded-sm shrink-0 ${SEVERITY_TONE[c.severity] || SEVERITY_TONE.medium}`}>{c.severity}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] uppercase tracking-widest text-neutral-500">
          <span className="text-neutral-400">{REASON_LABEL[c.risk_reason] || c.risk_reason}</span>
          {c.mentor?.display_name && <span>· mentor {c.mentor.display_name}</span>}
          {c.follow_up_at && <span className="text-amber-400">· follow-up {new Date(c.follow_up_at).toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
          <span className="ml-auto text-neutral-600">{rel(c.opened_at)}</span>
        </div>
      </button>
    );
  }

  function Column({ status }) {
    const st = STATUS_META[status];
    const list = grouped[status];
    return (
      <div className="flex-1 min-w-[240px]">
        <div className="flex items-center gap-2 mb-2">
          <span className={`h-2 w-2 rounded-full ${st.dot}`} />
          <span className="font-mono text-[11px] uppercase tracking-widest text-neutral-400">{st.label}</span>
          <span className="font-mono text-[10px] text-neutral-600">{list.length}</span>
        </div>
        <div className="space-y-2">
          {list.length === 0
            ? <p className="font-mono text-[11px] text-neutral-600 px-1 py-4">No {st.label.toLowerCase()} cases.</p>
            : list.map((c) => <CaseCard key={c.id} c={c} />)}
        </div>
      </div>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h2 className="font-mono text-xl text-white">Interventions</h2>
        <label className="font-mono text-[10px] uppercase tracking-widest text-neutral-400 flex items-center gap-2">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="accent-blood" />
          Show resolved
        </label>
      </div>

      {err && <p className="font-mono text-sm text-blood mb-3">{err}</p>}
      {ok && <p className="font-mono text-sm text-[#34d399] mb-3">{ok}</p>}

      {loading ? (
        <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-10 text-center">Loading cases…</p>
      ) : cases.length === 0 ? (
        <p className="font-mono text-sm text-neutral-500 py-10 text-center">
          No cases yet. Open one from an at-risk intern in <span className="text-neutral-300">Tasks &amp; Review → Cohort Health</span>.
        </p>
      ) : (
        <div className="flex gap-4 flex-wrap items-start">
          <Column status="open" />
          <Column status="monitoring" />
          {showResolved && <Column status="resolved" />}
        </div>
      )}

      {/* Case drawer */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/70 backdrop-blur-sm" onClick={() => !busy && closeDrawer()}>
          <div className="w-full max-w-md h-full overflow-y-auto bg-ink-950 border-l border-blood/30 p-5 space-y-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <button type="button" onClick={() => onOpenProfile?.(selected.intern_id)} className="font-mono text-lg text-white hover:text-blood transition text-left">
                  {nameOf(selected.intern)}
                </button>
                <div className="font-mono text-[11px] text-neutral-500">{selected.intern?.member_id || "no id"}</div>
              </div>
              <button onClick={closeDrawer} className="text-neutral-500 hover:text-white text-2xl leading-none shrink-0">×</button>
            </div>

            {selected.summary && <p className="font-mono text-xs text-neutral-400 border border-blood/15 rounded-sm p-3 bg-ink-900/30">{selected.summary}</p>}

            {/* Status */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Status</div>
              <div className="flex gap-2 flex-wrap">
                {["open", "monitoring", "resolved"].map((s) => (
                  <button key={s} type="button" disabled={busy} onClick={() => setStatus(s)}
                    className={`font-mono text-[10px] uppercase tracking-widest border px-2.5 py-1 rounded-sm transition disabled:opacity-50 ${selected.status === s ? STATUS_META[s].tone + " bg-ink-900/60" : "border-neutral-800 text-neutral-400 hover:border-neutral-600"}`}>
                    {STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reason + severity (read-only chips) */}
            <div className="flex items-center gap-2 flex-wrap font-mono text-[10px] uppercase tracking-widest">
              <span className="border border-neutral-700 text-neutral-400 px-2 py-0.5 rounded-sm">{REASON_LABEL[selected.risk_reason] || selected.risk_reason}</span>
              <span className={`border px-2 py-0.5 rounded-sm ${SEVERITY_TONE[selected.severity] || SEVERITY_TONE.medium}`}>{selected.severity} severity</span>
            </div>

            {/* Mentor */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Mentor</div>
              <select disabled={busy} value={selected.mentor_id || ""} onChange={(e) => assignMentor(e.target.value)} className={input + " w-full"}>
                <option value="">— unassigned —</option>
                {mentors.map((m) => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
              </select>
            </div>

            {/* Follow-up */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Follow-up</div>
              <div className="flex gap-2">
                <input type="datetime-local" value={followInput} onChange={(e) => setFollowInput(e.target.value)} className={input + " flex-1"} />
                <button type="button" disabled={busy} onClick={setFollowUp} className={btnGhost}>Set</button>
              </div>
            </div>

            {/* Outreach */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Log outreach</div>
              <div className="flex gap-2 flex-wrap">
                {OUTREACH.map((o) => (
                  <button key={o.id} type="button" disabled={busy} onClick={() => logOutreach(o.id)} className={btnGhost}>{o.label}</button>
                ))}
              </div>
              <p className="font-mono text-[10px] text-neutral-600 mt-1">Records the touch on the timeline. Send the actual email from Cohort Health → “Email all at-risk”.</p>
            </div>

            {/* Private notes */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Private notes <span className="text-neutral-700">(staff-only)</span></div>
              <div className="flex gap-2">
                <textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a private note…" className={input + " flex-1 resize-y"} />
                <button type="button" disabled={busy || !noteText.trim()} onClick={addNote} className={btnGhost + " self-start"}>Add</button>
              </div>
              <div className="mt-3 space-y-2">
                {notes.map((n) => (
                  <div key={n.id} className="border border-neutral-800 rounded-sm p-2.5 bg-ink-900/30">
                    <div className="flex items-center justify-between font-mono text-[10px] text-neutral-600">
                      <span>{n.author_name || "Staff"}</span><span>{rel(n.created_at)}</span>
                    </div>
                    <p className="font-mono text-xs text-neutral-300 mt-1 whitespace-pre-wrap">{n.body}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Timeline */}
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mb-2">Timeline</div>
              {drawerLoading ? (
                <p className="font-mono text-[11px] text-neutral-600 animate-pulse">Loading…</p>
              ) : (
                <ol className="space-y-1.5">
                  {events.map((e) => (
                    <li key={e.id} className="font-mono text-[11px] text-neutral-400 flex items-baseline gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-blood/60 shrink-0 translate-y-1.5" />
                      <span className="text-neutral-300">{EVENT_LABEL[e.kind] || e.kind}</span>
                      {e.detail && <span className="text-neutral-600 truncate">· {e.detail}</span>}
                      <span className="ml-auto text-neutral-700 shrink-0">{rel(e.created_at)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
