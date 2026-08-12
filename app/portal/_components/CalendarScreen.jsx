"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtTimeLocalAndPKT } from "../_lib";

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function CalendarScreen({ me, onBack, onOpenTasks }) {
  const [tasks, setTasks] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [attendance, setAttendance] = useState({});
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  // The month being viewed, as a Date on the 1st.
  const [cursor, setCursor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });

  useEffect(() => {
    let stop = false;
    Promise.all([
      supabase.from("tasks").select("id,week,title,due_at").not("due_at", "is", null),
      supabase.from("live_sessions").select("id,title,description,starts_at,join_url"),
      supabase.from("live_session_attendance").select("session_id,status,checked_in_at").eq("user_id", me.id),
    ]).then(([{ data: t }, { data: s }, { data: a }]) => {
      if (stop) return;
      setTasks(t || []); setSessions(s || []); setLoading(false);
      setAttendance(Object.fromEntries((a || []).map((row) => [row.session_id, row])));
    });
    return () => { stop = true; };
  }, [me.id]);

  // Map each YYYY-MM-DD → list of events.
  const byDay = useMemo(() => {
    const m = {};
    const push = (dateStr, ev) => { (m[dateStr] ||= []).push(ev); };
    for (const t of tasks) push(ymd(new Date(t.due_at)), { kind: "deadline", when: t.due_at, title: `Task ${t.week} deadline${t.title ? ` · ${t.title}` : ""}` });
    for (const s of sessions) push(ymd(new Date(s.starts_at)), { id: s.id, kind: "session", when: s.starts_at, title: s.title, url: s.join_url, desc: s.description });
    return m;
  }, [tasks, sessions]);

  const grid = useMemo(() => {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startPad = first.getDay(); // 0..6 (Sun start)
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  // Agenda: this month's events, sorted.
  const agenda = useMemo(() => {
    const y = cursor.getFullYear(), mo = cursor.getMonth();
    const list = [];
    for (const [day, evs] of Object.entries(byDay)) {
      const dt = new Date(day + "T00:00:00");
      if (dt.getFullYear() === y && dt.getMonth() === mo) evs.forEach((e) => list.push(e));
    }
    return list.sort((a, b) => new Date(a.when) - new Date(b.when));
  }, [byDay, cursor]);

  const todayStr = ymd(new Date());
  const fmtDay = (ts) => { try { return new Date(ts).toLocaleDateString([], { weekday: "short", day: "numeric" }); } catch { return ""; } };
  async function setSessionStatus(sessionId, status) {
    setErr("");
    const payload = { session_id: sessionId, user_id: me.id, status, checked_in_at: status === "attended" ? new Date().toISOString() : null };
    const { error } = await supabase.from("live_session_attendance").upsert(payload, { onConflict: "session_id,user_id" });
    if (error) return setErr("Attendance is not ready. Run migration 062_session_attendance.sql.");
    setAttendance((m) => ({ ...m, [sessionId]: payload }));
  }

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Calendar</h1>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back
          </button>
        </div>
      </header>

      <main className="w-full px-4 sm:px-6 lg:px-8 py-6 font-mono">
        {err && <p className="text-blood text-xs mb-4">{err}</p>}
        {loading ? (
          <p className="text-center text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-16">Loading…</p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <button onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))} className="px-3 py-1.5 border border-neutral-700 rounded-sm text-neutral-300 hover:border-blood hover:text-blood transition text-sm">←</button>
              <h2 className="text-sm text-white">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</h2>
              <button onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))} className="px-3 py-1.5 border border-neutral-700 rounded-sm text-neutral-300 hover:border-blood hover:text-blood transition text-sm">→</button>
            </div>

            <div className="grid grid-cols-7 gap-1 mb-6">
              {DOW.map((d) => <div key={d} className="text-center text-[10px] uppercase tracking-widest text-neutral-500 py-1">{d}</div>)}
              {grid.map((date, i) => {
                if (!date) return <div key={i} className="aspect-square" />;
                const key = ymd(date);
                const evs = byDay[key] || [];
                const isToday = key === todayStr;
                return (
                  <div key={i} className={`aspect-square rounded-sm border p-1 flex flex-col ${isToday ? "border-blood bg-blood/10" : "border-neutral-800 bg-ink-900/50"}`}>
                    <span className={`text-[11px] ${isToday ? "text-blood font-bold" : "text-neutral-400"}`}>{date.getDate()}</span>
                    <div className="flex gap-0.5 mt-auto flex-wrap">
                      {evs.slice(0, 3).map((e, j) => (
                        <span key={j} title={e.title} className={`w-1.5 h-1.5 rounded-full ${e.kind === "deadline" ? "bg-blood" : "bg-[#38bdf8]"}`} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-4 text-[11px] text-neutral-500 mb-4">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blood inline-block" /> Task deadline</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#38bdf8] inline-block" /> Live session</span>
            </div>

            <h3 className="text-xs uppercase tracking-widest text-neutral-400 mb-3">This month</h3>
            {agenda.length === 0 ? (
              <p className="text-sm text-neutral-500">Nothing scheduled this month.</p>
            ) : (
              <ul className="space-y-2">
                {agenda.map((e, i) => (
                  <li key={i} className="flex items-center gap-3 border border-neutral-800 rounded-sm p-3 bg-ink-900/50">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${e.kind === "deadline" ? "bg-blood" : "bg-[#38bdf8]"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-neutral-200 truncate">{e.title}</p>
                      {e.kind === "session" && e.desc && <p className="text-[11px] text-neutral-500 truncate">{e.desc}</p>}
                    </div>
                    <span className="text-[11px] text-neutral-500 shrink-0">{fmtDay(e.when)} · {fmtTimeLocalAndPKT(e.when)}</span>
                    {e.kind === "session" && e.url && (
                      <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#38bdf8] hover:underline shrink-0">Join</a>
                    )}
                    {e.kind === "session" && (
                      <div className="flex items-center gap-1 shrink-0">
                        <button onClick={() => setSessionStatus(e.id, "going")} className={`text-[10px] uppercase tracking-widest border px-2 py-1 rounded-sm ${attendance[e.id]?.status === "going" ? "border-[#34d399] text-[#34d399]" : "border-neutral-700 text-neutral-400"}`}>RSVP</button>
                        <button onClick={() => setSessionStatus(e.id, "attended")} className={`text-[10px] uppercase tracking-widest border px-2 py-1 rounded-sm ${attendance[e.id]?.status === "attended" ? "border-[#38bdf8] text-[#38bdf8]" : "border-neutral-700 text-neutral-400"}`}>Check in</button>
                      </div>
                    )}
                    {e.kind === "deadline" && onOpenTasks && (
                      <button onClick={onOpenTasks} className="text-[11px] text-blood hover:underline shrink-0">Open</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
    </div>
  );
}
