"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtTimeLocalAndPKT } from "../_lib";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

  const now = Date.now();
  const todayStr = ymd(new Date());
  const nextIdx = agenda.findIndex((e) => new Date(e.when).getTime() >= now);
  const deadlineCount = agenda.filter((e) => e.kind === "deadline").length;
  const sessionCount = agenda.filter((e) => e.kind === "session").length;
  const isThisMonth = cursor.getFullYear() === new Date().getFullYear() && cursor.getMonth() === new Date().getMonth();

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

      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-mono">
        {err && <p className="text-blood text-xs mb-4 border border-blood/30 bg-blood/5 rounded-sm px-3 py-2">{err}</p>}
        {loading ? (
          <p className="text-center text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-16">Loading…</p>
        ) : (
          <div className="grid lg:grid-cols-[1fr,minmax(320px,380px)] gap-6 items-start">
            {/* Calendar panel */}
            <section className="border border-blood/20 rounded-lg bg-ink-900/40 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg sm:text-xl text-white">{MONTHS[cursor.getMonth()]} <span className="text-neutral-500">{cursor.getFullYear()}</span></h2>
                  <div className="flex items-center gap-3 mt-1 text-[11px] text-neutral-500">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blood inline-block" />{deadlineCount} deadline{deadlineCount === 1 ? "" : "s"}</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-[#38bdf8] inline-block" />{sessionCount} session{sessionCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {!isThisMonth && (
                    <button onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }}
                      className="px-2.5 py-1.5 border border-neutral-700 rounded-sm text-[11px] uppercase tracking-widest text-neutral-300 hover:border-blood hover:text-blood transition">Today</button>
                  )}
                  <button aria-label="Previous month" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))} className="w-8 h-8 grid place-items-center border border-neutral-700 rounded-sm text-neutral-300 hover:border-blood hover:text-blood transition">←</button>
                  <button aria-label="Next month" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))} className="w-8 h-8 grid place-items-center border border-neutral-700 rounded-sm text-neutral-300 hover:border-blood hover:text-blood transition">→</button>
                </div>
              </div>

              <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {DOW.map((d) => <div key={d} className="text-center text-[9px] sm:text-[10px] uppercase tracking-widest text-neutral-600 pb-1">{d}</div>)}
                {grid.map((date, i) => {
                  if (!date) return <div key={i} className="min-h-[52px] sm:min-h-[84px]" />;
                  const key = ymd(date);
                  const evs = byDay[key] || [];
                  const isToday = key === todayStr;
                  const hasEvents = evs.length > 0;
                  return (
                    <div key={i} className={`min-h-[52px] sm:min-h-[84px] rounded-md border p-1 sm:p-1.5 flex flex-col transition ${isToday ? "border-blood/70 bg-blood/10 ring-1 ring-blood/30" : hasEvents ? "border-neutral-700 bg-ink-900/70 hover:border-neutral-600" : "border-neutral-800/60 bg-ink-900/30"}`}>
                      <span className={`text-[10px] sm:text-[11px] ${isToday ? "text-blood font-bold" : hasEvents ? "text-neutral-300" : "text-neutral-600"}`}>{date.getDate()}</span>
                      {/* Mobile: colored dots */}
                      <div className="flex gap-0.5 mt-auto flex-wrap sm:hidden">
                        {evs.slice(0, 3).map((e, j) => (
                          <span key={j} title={e.title} className={`w-1.5 h-1.5 rounded-full ${e.kind === "deadline" ? "bg-blood" : "bg-[#38bdf8]"}`} />
                        ))}
                      </div>
                      {/* Desktop: labelled event pills */}
                      <div className="hidden sm:flex flex-col gap-1 mt-1 overflow-hidden">
                        {evs.slice(0, 2).map((e, j) => (
                          <span key={j} title={e.title} className={`text-[9px] leading-tight truncate rounded-sm px-1 py-0.5 border ${e.kind === "deadline" ? "border-blood/40 bg-blood/10 text-blood" : "border-[#38bdf8]/40 bg-[#38bdf8]/10 text-[#38bdf8]"}`}>
                            {e.kind === "deadline" ? "⚑ " : "▶ "}{e.title}
                          </span>
                        ))}
                        {evs.length > 2 && <span className="text-[9px] text-neutral-500 pl-1">+{evs.length - 2} more</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Agenda panel */}
            <section className="lg:sticky lg:top-20">
              <div className="flex items-baseline justify-between gap-2 mb-3">
                <h3 className="text-xs uppercase tracking-widest text-neutral-400">Agenda · this month</h3>
                <span className="text-[10px] text-neutral-600">{agenda.length} event{agenda.length === 1 ? "" : "s"}</span>
              </div>
              {agenda.length === 0 ? (
                <div className="border border-neutral-800 rounded-md bg-ink-900/30 p-6 text-center text-sm text-neutral-500">Nothing scheduled this month.</div>
              ) : (
                <ul className="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                  {agenda.map((e, i) => {
                    const d = new Date(e.when);
                    const isPast = d.getTime() < now;
                    const isNext = i === nextIdx;
                    const att = e.kind === "session" ? attendance[e.id] : null;
                    return (
                      <li key={i} className={`relative rounded-md border bg-ink-900/40 pl-4 pr-3 py-2.5 flex items-center gap-3 flex-wrap transition ${isNext ? "border-blood/50 bg-blood/[0.04]" : "border-neutral-800 hover:border-neutral-700"} ${isPast ? "opacity-55" : ""}`}>
                        <span className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-md ${e.kind === "deadline" ? "bg-blood" : "bg-[#38bdf8]"}`} />
                        {/* Date badge */}
                        <div className="flex flex-col items-center justify-center min-w-[42px] leading-none">
                          <span className="text-[9px] uppercase tracking-widest text-neutral-500">{d.toLocaleDateString([], { weekday: "short" })}</span>
                          <span className="text-xl font-bold text-white mt-0.5">{d.getDate()}</span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-neutral-100 truncate">{e.kind === "deadline" ? "⚑" : "🎥"} {e.title}</span>
                            {isNext && <span className="shrink-0 text-[9px] uppercase tracking-widest text-blood border border-blood/40 rounded-sm px-1.5 py-0.5">Next</span>}
                          </div>
                          {e.kind === "session" && e.desc && <p className="text-[11px] text-neutral-500 truncate mt-0.5">{e.desc}</p>}
                          <p className="text-[11px] text-neutral-500 mt-0.5">{fmtTimeLocalAndPKT(e.when)}</p>
                          {(e.kind === "session" || (e.kind === "deadline" && onOpenTasks)) && (
                            <div className="flex items-center gap-1.5 flex-wrap mt-2">
                              {e.kind === "session" && e.url && (
                                <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-2 py-1 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition">Join</a>
                              )}
                              {e.kind === "session" && (
                                <>
                                  <button onClick={() => setSessionStatus(e.id, "going")} className={`text-[10px] uppercase tracking-widest border px-2 py-1 rounded-sm transition ${att?.status === "going" ? "border-[#34d399] text-[#34d399] bg-[#34d399]/10" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}>{att?.status === "going" ? "✓ RSVP'd" : "RSVP"}</button>
                                  <button onClick={() => setSessionStatus(e.id, "attended")} className={`text-[10px] uppercase tracking-widest border px-2 py-1 rounded-sm transition ${att?.status === "attended" ? "border-[#38bdf8] text-[#38bdf8] bg-[#38bdf8]/10" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"}`}>{att?.status === "attended" ? "✓ Checked in" : "Check in"}</button>
                                </>
                              )}
                              {e.kind === "deadline" && onOpenTasks && (
                                <button onClick={onOpenTasks} className="text-[10px] uppercase tracking-widest border border-blood/50 text-blood px-2 py-1 rounded-sm hover:bg-blood hover:text-ink-950 transition">Open task</button>
                              )}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
