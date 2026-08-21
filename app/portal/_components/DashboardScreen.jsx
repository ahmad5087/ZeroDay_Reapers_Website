"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { downloadFromR2 } from "@/lib/r2client";
import SkillPassport from "./SkillPassport";

const GOAL = 6; // approved submissions that complete the internship (matches TasksScreen)

// Live ticking clock, only while there's something to count down to.
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function Countdown({ target }) {
  const now = useNow(!!target);
  if (!target) return <span className="text-neutral-500">—</span>;
  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return <span className="text-blood font-bold">overdue</span>;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return (
    <span className="tabular-nums text-white font-bold">
      {d > 0 ? `${d}d ` : ""}{pad(h)}:{pad(m)}:{pad(sec)}
    </span>
  );
}

function Tile({ label, value, tone = "neutral" }) {
  const color =
    tone === "good" ? "text-[#34d399]" :
    tone === "warn" ? "text-amber-400" :
    tone === "bad" ? "text-blood" : "text-white";
  return (
    <div className="panel border border-blood/15 rounded-sm p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-neutral-500 mt-1">{label}</div>
    </div>
  );
}

export default function DashboardScreen({ me, onBack, onOpenTasks }) {
  const [tasks, setTasks] = useState([]);
  const [subs, setSubs] = useState({});   // task_id -> submission row
  const [exts, setExts] = useState({});   // task_id -> approved extended_until (ISO)
  const [anns, setAnns] = useState([]);
  const [streak, setStreak] = useState(null); // { current_streak, longest_streak, last_active, active_today, total_days }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let stop = false;
    supabase.rpc("my_login_streak").then(({ data }) => { if (!stop) setStreak(data?.[0] || null); });
    return () => { stop = true; };
  }, [me.id]);

  useEffect(() => {
    let stop = false;
    async function load() {
      // tasks are RLS-scoped to this student's domain + RAM already.
      const [{ data: t }, { data: s }, { data: e }, { data: a }] = await Promise.all([
        supabase.from("tasks").select("*").order("week", { ascending: true }),
        supabase.from("submissions").select("task_id,status,submitted_at,graded_at,feedback").eq("user_id", me.id),
        supabase.from("task_extension_requests").select("task_id,status,extended_until").eq("user_id", me.id),
        supabase.from("announcements").select("id,title,created_at").order("created_at", { ascending: false }).limit(5),
      ]);
      if (stop) return;
      setTasks(t || []);
      const sm = {}; (s || []).forEach((r) => { sm[r.task_id] = r; }); setSubs(sm);
      const em = {}; (e || []).forEach((r) => { if (r.status === "approved" && r.extended_until) em[r.task_id] = r.extended_until; }); setExts(em);
      setAnns(a || []);
      setLoading(false);
    }
    load();
    return () => { stop = true; };
  }, [me.id]);

  const tasksById = useMemo(() => Object.fromEntries(tasks.map((t) => [t.id, t])), [tasks]);

  const stats = useMemo(() => {
    const now = Date.now();
    let approved = 0, pendingReview = 0, needsChanges = 0, upcoming = 0, late = 0;
    let nextDue = null;
    for (const task of tasks) {
      const sub = subs[task.id];
      const effDue = exts[task.id] || task.due_at;
      const dueMs = effDue ? new Date(effDue).getTime() : null;
      if (sub?.status === "approved") { approved++; continue; }
      if (sub?.status === "submitted") pendingReview++;
      else if (sub?.status === "rejected") needsChanges++;
      const overdue = dueMs != null && dueMs < now;
      if (overdue) late++;
      else if (dueMs != null && !sub) upcoming++;
      if (dueMs != null && dueMs >= now && (nextDue == null || dueMs < nextDue.ms)) nextDue = { ms: dueMs, task, due: effDue };
    }
    const pct = Math.min(100, Math.round((approved / GOAL) * 100));
    return { approved, pendingReview, needsChanges, upcoming, late, nextDue, pct };
  }, [tasks, subs, exts]);

  const badges = useMemo(() => {
    const anySub = Object.keys(subs).length > 0;
    return [
      { key: "first", label: "First Strike", desc: "Made your first submission", earned: anySub },
      { key: "initiate", label: "Initiate", desc: "1 task approved", earned: stats.approved >= 1 },
      { key: "halfway", label: "Halfway There", desc: "3 tasks approved", earned: stats.approved >= 3 },
      { key: "reaper", label: "Reaper", desc: "All 6 approved", earned: stats.approved >= GOAL },
    ];
  }, [subs, stats.approved]);

  const isAlumni = me.is_alumni && me.role !== "admin";

  // Alumni earned everything, plus the Graduated badge (+ Best Intern if marked).
  const alumniBadges = useMemo(() => {
    const b = [
      { key: "first", label: "First Strike", desc: "Made your first submission", icon: "🩸" },
      { key: "initiate", label: "Initiate", desc: "1 task approved", icon: "🩸" },
      { key: "halfway", label: "Halfway There", desc: "3 tasks approved", icon: "🩸" },
      { key: "reaper", label: "Reaper", desc: "All 6 approved", icon: "🩸" },
      { key: "graduate", label: "Graduated", desc: "Completed the internship", icon: "🎓" },
    ];
    if (me.is_best_intern) b.push({ key: "best", label: "Best Intern", desc: "Top performer of your department", icon: "🏆" });
    return b;
  }, [me.is_best_intern]);

  const recentResults = useMemo(() =>
    Object.values(subs)
      .filter((s) => s.graded_at)
      .sort((a, b) => new Date(b.graded_at) - new Date(a.graded_at))
      .slice(0, 4)
      .map((s) => ({ ...s, task: tasksById[s.task_id] })),
    [subs, tasksById]);

  const game = useMemo(() => {
    const submitted = Object.values(subs).length;
    const approved = Object.values(subs).filter((s) => s.status === "approved").length;
    const rejectedFixed = Object.values(subs).filter((s) => s.status === "approved" && s.feedback).length;
    const xp = submitted * 25 + approved * 100 + rejectedFixed * 20;
    const level = Math.max(1, Math.floor(xp / 250) + 1);
    const nextXp = level * 250;
    const levelPct = Math.min(100, Math.round(((xp % 250) / 250) * 100));
    let streak = 0;
    for (const week of [...new Set(tasks.map((t) => Number(t.week)))].sort((a, b) => a - b)) {
      const weekTasks = tasks.filter((t) => Number(t.week) === week);
      if (weekTasks.some((t) => subs[t.id]?.status === "approved")) streak++;
      else break;
    }
    const nextBadge = badges.find((b) => !b.earned);
    return { xp, level, nextXp, levelPct, streak, nextBadge };
  }, [subs, tasks, badges]);

  const fmt = (ts) => { try { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; } };

  // "New announcement" ribbon (sale-banner style): the newest announcement, shown for 24h after it was
  // posted, dismissible per device (dismissing one still lets the NEXT new announcement show its ribbon).
  const [dismissedAnn, setDismissedAnn] = useState(0);
  useEffect(() => {
    try { setDismissedAnn(Number(localStorage.getItem("zdr_ann_ribbon_dismissed") || 0)); } catch { /* ignore */ }
  }, []);
  const ribbon = useMemo(() => {
    const a = anns[0];
    if (!a) return null;
    const ageMs = Date.now() - new Date(a.created_at).getTime();
    if (ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) return null; // only within 24h of posting
    return a.id > dismissedAnn ? a : null;
  }, [anns, dismissedAnn]);
  function dismissRibbon() {
    if (!ribbon) return;
    setDismissedAnn(ribbon.id);
    try { localStorage.setItem("zdr_ann_ribbon_dismissed", String(ribbon.id)); } catch { /* ignore */ }
  }

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest text-white truncate min-w-0">
            Dashboard · <span className="text-blood">{me.display_name}</span>
          </h1>
          <div className="flex items-center gap-2">
            {!isAlumni && (
              <button onClick={onOpenTasks} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
                Tasks →
              </button>
            )}
            <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
              ← Chat
            </button>
          </div>
        </div>
      </header>

      {ribbon && (
        <div className="bg-gradient-to-r from-blood/30 via-blood/15 to-blood/30 border-b border-blood/40">
          <div className="w-full px-4 sm:px-6 lg:px-8 py-2.5 flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-blood font-bold shrink-0 animate-pulse">📣 New</span>
            <button onClick={onBack} title="Open chat to read the announcement"
              className="min-w-0 flex-1 text-left font-mono text-xs text-neutral-200 truncate hover:text-white transition">
              {ribbon.title} <span className="text-neutral-500">— tap to read</span>
            </button>
            <button onClick={dismissRibbon} aria-label="Dismiss announcement ribbon"
              className="shrink-0 font-mono text-xs text-neutral-400 hover:text-blood">✕</button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-center font-mono text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-24">Loading your dashboard…</p>
      ) : isAlumni ? (
        <main className="w-full px-4 sm:px-6 lg:px-8 py-8 space-y-8 font-mono">
          <div className="text-center">
            <div className="text-4xl mb-2">🎓</div>
            <h2 className="text-lg text-white font-bold">Congratulations, {me.display_name}!</h2>
            <p className="text-sm text-neutral-400 mt-1">You've graduated from the ZeroDay Reapers internship.</p>
          </div>

          {/* Certificates */}
          <div className="panel border border-blood/20 rounded-sm p-6">
            <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-4">Your documents</h2>
            {(me.certificate_key || me.lor_key) ? (
              <div className="flex flex-wrap gap-3">
                {me.certificate_key && (
                  <button onClick={() => downloadFromR2(me.certificate_key)}
                    className="inline-flex items-center gap-2 btn-neon font-bold uppercase tracking-widest text-xs px-5 py-3 rounded-sm hover:bg-blood-glow transition">
                    ⬇ {me.is_best_intern ? "Best Intern Certificate" : "Internship Certificate"}
                  </button>
                )}
                {me.lor_key && (
                  <button onClick={() => downloadFromR2(me.lor_key)}
                    className="inline-flex items-center gap-2 border border-amber-500 text-amber-400 font-bold uppercase tracking-widest text-xs px-5 py-3 rounded-sm hover:bg-amber-500 hover:text-ink-950 transition">
                    ⬇ Letter of Recommendation
                  </button>
                )}
              </div>
            ) : (
              <p className="text-sm text-neutral-500">Your certificate will appear here once an admin issues it.</p>
            )}
          </div>

          {/* Badges only */}
          <div>
            <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-3">Badges</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {alumniBadges.map((b) => (
                <div key={b.key} className={`rounded-sm p-5 border text-center ${b.key === "best" ? "border-amber-500/60 bg-amber-500/10" : "border-blood/40 bg-blood/10"}`}>
                  <div className="text-3xl">{b.icon}</div>
                  <div className="text-xs font-bold mt-2 text-white">{b.label}</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">{b.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </main>
      ) : (
        <main className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6 font-mono">
          {/* Progress + next deadline */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="panel border border-blood/20 rounded-sm p-6">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-widest text-neutral-400">Internship progress</span>
                <span className="text-blood font-bold">{stats.approved}/{GOAL}</span>
              </div>
              <div className="mt-3 h-2 bg-neutral-800 rounded-sm overflow-hidden">
                <div className="h-full bg-blood transition-all" style={{ width: `${stats.pct}%` }} />
              </div>
              <p className="mt-2 text-[11px] text-neutral-500">
                {stats.approved >= GOAL ? "All tasks approved — eligible to graduate to Alumni. 🎓" : `${GOAL - stats.approved} more approved to complete the program.`}
              </p>
            </div>
            <div className="panel border border-blood/20 rounded-sm p-6">
              <span className="text-xs uppercase tracking-widest text-neutral-400">Next deadline</span>
              {stats.nextDue ? (
                <>
                  <p className="mt-2 text-sm text-white truncate">Week {stats.nextDue.task.week} · {stats.nextDue.task.title}</p>
                  <p className="mt-1 text-lg"><Countdown target={stats.nextDue.due} /></p>
                  <p className="mt-1 text-[11px] text-neutral-500">Due {fmt(stats.nextDue.due)}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-neutral-500">No upcoming deadlines.</p>
              )}
            </div>
          </div>

          {/* Gamified progress */}
          <div className="panel border border-blood/20 rounded-sm p-5">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-3">
              <div>
                <h2 className="text-xs uppercase tracking-widest text-neutral-400">Reaper XP</h2>
                <p className="text-2xl font-bold text-white mt-1">Level {game.level} <span className="text-blood">{game.xp} XP</span></p>
              </div>
              <div className="text-right">
                <div className="text-sm text-[#34d399] font-bold">{game.streak} week streak</div>
                <div className="text-[10px] uppercase tracking-widest text-neutral-500">approved from week 1</div>
              </div>
            </div>
            <div className="h-2 w-full bg-ink-800 rounded-sm overflow-hidden border border-blood/20">
              <div className="h-full bg-blood transition-all duration-500" style={{ width: `${game.levelPct}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-neutral-500">
              <span>{Math.max(0, game.nextXp - game.xp)} XP to next level</span>
              <span>{game.nextBadge ? `Next badge: ${game.nextBadge.label}` : "All badges earned"}</span>
            </div>
            {/* Daily login streak (PKT day boundary) */}
            <div className="mt-3 pt-3 border-t border-blood/15 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className={`text-xl ${streak?.active_today ? "" : "grayscale opacity-60"}`}>🔥</span>
                <div>
                  <div className="text-sm font-bold text-white">{streak?.current_streak || 0}-day login streak</div>
                  <div className="text-[10px] uppercase tracking-widest text-neutral-500">
                    {streak?.active_today ? "Active today ✓ · " : "Log in today to keep it · "}longest {streak?.longest_streak || 0}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-[#34d399] font-bold">{streak?.total_days || 0}</div>
                <div className="text-[10px] uppercase tracking-widest text-neutral-500">active days</div>
              </div>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Tile label="Approved" value={stats.approved} tone="good" />
            <Tile label="Pending review" value={stats.pendingReview} tone="warn" />
            <Tile label="Needs changes" value={stats.needsChanges} tone="bad" />
            <Tile label="Upcoming" value={stats.upcoming} />
            <Tile label="Late / overdue" value={stats.late} tone={stats.late ? "bad" : "neutral"} />
          </div>

          {/* Badges */}
          <div>
            <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-3">Badges</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {badges.map((b) => (
                <div key={b.key} className={`rounded-sm p-4 border text-center ${b.earned ? "border-blood/40 bg-blood/10" : "border-neutral-800 panel opacity-60"}`}>
                  <div className="text-2xl">{b.earned ? "🩸" : "🔒"}</div>
                  <div className={`text-xs font-bold mt-1 ${b.earned ? "text-white" : "text-neutral-500"}`}>{b.label}</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">{b.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Competency — Skill Passport (feature-flagged; renders null when off / no marks) */}
          <SkillPassport me={me} />

          {/* Notifications: announcements + recent results */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="panel border border-blood/15 rounded-sm p-5">
              <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-3">Latest announcements</h2>
              {anns.length ? (
                <ul className="space-y-2">
                  {anns.map((a) => (
                    <li key={a.id} className="text-xs text-neutral-300 flex justify-between gap-3">
                      <span className="truncate">{a.title}</span>
                      <span className="text-neutral-600 shrink-0">{fmt(a.created_at)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-neutral-500">Nothing yet.</p>}
            </div>
            <div className="panel border border-blood/15 rounded-sm p-5">
              <h2 className="text-xs uppercase tracking-widest text-neutral-400 mb-3">Recent results</h2>
              {recentResults.length ? (
                <ul className="space-y-2">
                  {recentResults.map((r) => (
                    <li key={r.task_id} className="text-xs flex justify-between gap-3">
                      <span className="truncate text-neutral-300">{r.task ? `Week ${r.task.week} · ${r.task.title}` : "Task"}</span>
                      <span className={`shrink-0 ${r.status === "approved" ? "text-[#34d399]" : r.status === "rejected" ? "text-blood" : "text-amber-400"}`}>
                        {r.status}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-neutral-500">No graded submissions yet.</p>}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
