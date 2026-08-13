"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { initials, colorFor, pktLocalInputToISO, fmtLocalAndPKT } from "../_lib";
import Flag from "@/app/_components/Flag";
import { COUNTRIES, dialFor } from "@/lib/countries";
import { uploadToR2, downloadFromR2, deleteFromR2 } from "@/lib/r2client";
import { notifyUser, broadcastEmail, emailSelf } from "@/lib/notify";
import PasswordInput from "./PasswordInput";

// Canned mentor feedback — quick presets in the grade dialog (admin can still edit).
const CANNED_APPROVE = [
  "Solid work — clean methodology and clear reporting.",
  "Approved. Good use of tooling and well-documented steps.",
  "Great findings with a reproducible PoC. Keep it up.",
];
const CANNED_REJECT = [
  "Missing reproduction steps — add exact commands and screenshots.",
  "Scope incomplete — several required items are not addressed.",
  "Report lacks impact/remediation — please expand and resubmit.",
  "Formatting/readability needs work — structure your writeup.",
];

// Same strength policy as signup.
const PW_RULES = [
  { label: "12+ characters", test: (p) => p.length >= 12 },
  { label: "an uppercase letter", test: (p) => /[A-Z]/.test(p) },
  { label: "a lowercase letter", test: (p) => /[a-z]/.test(p) },
  { label: "a number", test: (p) => /[0-9]/.test(p) },
  { label: "a symbol", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

// One submissions table row — shared by the grouped + unassigned tables.
function SubRow({ s, selected, onToggle, onGrade, onDownload, onHistory, onFeedbackReport, isFounder }) {
  const canSelect = s.status !== "approved";
  const decided = s.status === "approved" || s.status === "rejected"; // disable Approve/Reject once acted on
  // Once graded, a regular admin can no longer change the verdict. A FOUNDER may override a decided
  // submission and flip it (approve↔reject) — only the opposite-verdict button stays live, so the
  // button that matches the current status is still disabled (nothing to change).
  const approveDisabled = decided && (s.status === "approved" || !isFounder);
  const rejectDisabled = decided && (s.status === "rejected" || !isFounder);
  return (
    <tr className="border-t border-blood/10 hover:bg-ink-900/40 transition">
      <td className="px-4 py-3">
        {canSelect && (
          <input type="checkbox" checked={selected} onChange={() => onToggle(s.id)} className="accent-blood cursor-pointer" title="Select for bulk approve" />
        )}
      </td>
      <td className="px-4 py-3 text-white">{s.profiles?.display_name || "—"}</td>
      <td className="px-4 py-3 text-neutral-300">W{s.tasks?.week} · {s.tasks?.title}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          {s.file_path
            ? <button onClick={() => onDownload(s.file_path)} className="text-blood hover:underline inline-flex items-center gap-1"><span>📄</span><span>{s.file_name || "download"}</span></button>
            : <span className="text-neutral-600">—</span>}
          <button onClick={() => onHistory(s)} className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-blood" title="Version history">history</button>
          {s.graded_at && (
            <button onClick={() => onFeedbackReport(s)} className="text-[10px] uppercase tracking-widest text-neutral-500 hover:text-blood" title="Download feedback report">feedback</button>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={s.status === "approved" ? "text-[#34d399]" : s.status === "rejected" ? "text-blood" : "text-amber-400"}>{s.status}</span>
      </td>
      <td className="px-4 py-3 text-neutral-400 whitespace-nowrap text-xs">{fmtLocalAndPKT(s.submitted_at)}</td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <button
            disabled={approveDisabled}
            onClick={() => onGrade(s, "approved")}
            title={isFounder && s.status === "rejected" ? "Founder override — change verdict to Approved" : undefined}
            className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition disabled:opacity-40 disabled:pointer-events-none"
          >
            {isFounder && s.status === "rejected" ? "→ Approve" : "Approve"}
          </button>
          <button
            disabled={rejectDisabled}
            onClick={() => onGrade(s, "rejected")}
            title={isFounder && s.status === "approved" ? "Founder override — change verdict to Rejected" : undefined}
            className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1 rounded-sm hover:bg-blood hover:text-ink-950 transition disabled:opacity-40 disabled:pointer-events-none"
          >
            {isFounder && s.status === "approved" ? "→ Reject" : "Reject"}
          </button>
        </div>
      </td>
    </tr>
  );
}

// Table header cells shared by both submission tables (leading checkbox column).
function SubHead() {
  return (
    <thead className="bg-ink-900/60 text-neutral-500 uppercase text-xs tracking-widest border-b border-blood/10">
      <tr>
        <th className="text-left px-4 py-2.5 w-8"></th>
        <th className="text-left px-4 py-2.5">Student</th>
        <th className="text-left px-4 py-2.5">Task</th>
        <th className="text-left px-4 py-2.5">File</th>
        <th className="text-left px-4 py-2.5">Status</th>
        <th className="text-left px-4 py-2.5">Submitted</th>
        <th className="text-left px-4 py-2.5">Grade</th>
      </tr>
    </thead>
  );
}

// Human labels for portal-issue categories (mirrors ProfileScreen).
const ISSUE_LABELS = { bug: "Bug", ui: "Display", access: "Access", account: "Account", other: "Other" };

// Weekly Task Report status vocabulary — one resolved standing per intern per task, driving the
// label + colour in the single flat roster table below. Order here is also the summary-chip order.
const REPORT_STATUS_META = {
  approved:  { label: "Approved",            emoji: "✅", tone: "text-[#34d399]" },
  pending:   { label: "Pending review",      emoji: "⏳", tone: "text-amber-400" },
  rejected:  { label: "Rejected",            emoji: "⛔", tone: "text-blood" },
  extension: { label: "Extension requested", emoji: "🕓", tone: "text-[#38bdf8]" },
  missing:   { label: "No submission",       emoji: "❌", tone: "text-neutral-400" },
};

function normalizedSubmissionName(name = "") {
  return name
    .toLowerCase()
    .replace(/\.(pdf|docx|doc)$/i, "")
    .replace(/\b(copy|final|updated|new|latest|submission|report|task)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function gradeValue(v) {
  return v == null ? "-" : String(Number(v));
}

// last_active is a 'YYYY-MM-DD' PKT date string from get_login_streaks(); describe it relative to today (PKT).
function streakDaysAgo(lastActive) {
  if (!lastActive) return "never";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
  if (lastActive === today) return "today";
  const diff = Math.round((new Date(today + "T00:00:00Z") - new Date(lastActive + "T00:00:00Z")) / 86400000);
  if (diff === 1) return "yesterday";
  return diff > 0 ? `${diff}d ago` : "today";
}

// Compact absolute date+time for last-login / last-active columns.
function fmtDT(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return "—"; }
}

// Compact streak indicator: green dot = active today, amber = streak alive (missed today, not a full day),
// grey = no active streak. Shared by the engagement roster, members table, and profile modal.
function StreakBadge({ s }) {
  const cur = s?.current_streak || 0;
  const active = !!s?.active_today;
  return (
    <span className="inline-flex items-center gap-1.5" title={s ? `Current ${cur} · longest ${s.longest_streak} · ${s.total_days} active days · last sign-in ${fmtDT(s.last_login)} · last active ${fmtDT(s.last_active_at)}` : "No logins recorded yet"}>
      <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-[#34d399]" : cur > 0 ? "bg-amber-400" : "bg-neutral-700"}`} />
      <span className={cur > 0 ? "text-white" : "text-neutral-600"}>{cur > 0 ? `🔥 ${cur}` : "—"}</span>
    </span>
  );
}

export default function AdminPanel({ onBack, me, setMe }) {
  const [domains, setDomains] = useState([]);
  const [members, setMembers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [ann, setAnn] = useState({ title: "", body: "", link: "" });
  const [annFile, setAnnFile] = useState(null);  // optional announcement attachment
  const [annBusy, setAnnBusy] = useState(false); // uploading + posting
  const [annEmail, setAnnEmail] = useState(true); // email all students on post (admin can opt out per-announcement)
  const [name, setName] = useState(me?.display_name || "");
  const [tasks, setTasks] = useState([]);
  const [subs, setSubs] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]); // global message counts
  const [extReqs, setExtReqs] = useState([]); // pending extra-time requests
  const [changeReqs, setChangeReqs] = useState([]); // founder-only: pending submission-change requests
  const [audit, setAudit] = useState([]);
  const [reports, setReports] = useState([]);
  const [issues, setIssues] = useState([]); // portal issues reported by users
  const [userRecords, setUserRecords] = useState([]); // founder-only: consolidated signup/profile records
  const [subDomainFilter, setSubDomainFilter] = useState("");
  // Filters — Members section
  const [memberSearch, setMemberSearch] = useState("");
  const [memberType, setMemberType] = useState("");     // "" | student | admin | founder | alumni
  const [memberDept, setMemberDept] = useState("");      // "" | domain id
  const [memberStatus, setMemberStatus] = useState("");  // "" | approved | pending | rejected | banned
  const [memberSort, setMemberSort] = useState("");      // "" (join order) | name | country | ram
  // Filters — Submissions section (department filter is subDomainFilter above)
  const [subSearch, setSubSearch] = useState("");
  const [subStatus, setSubStatus] = useState("");        // "" | pending | approved | rejected
  // Filters — founder User Records section
  const [urSearch, setUrSearch] = useState("");
  const [urStatus, setUrStatus] = useState("");          // "" | approved | pending | rejected
  const [urDept, setUrDept] = useState("");              // "" | domain id
  const [taskForm, setTaskForm] = useState({ domain_id: "", week: "", title: "", due_at: "", ram: "" });
  const [taskFile, setTaskFile] = useState(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [grading, setGrading] = useState(null); // { sub, status } — open grade dialog
  const [fbText, setFbText] = useState("");
  const [scores, setScores] = useState({ completeness: "", accuracy: "", evidence: "", report: "" }); // rubric marks (approve only)
  const [selectedSubs, setSelectedSubs] = useState(() => new Set()); // bulk-approve selection
  const [history, setHistory] = useState(null); // { sub, files } — version-history dialog
  const [pw, setPw] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [editMember, setEditMember] = useState(null); // { id, display_name, full_name, gender }
  const [editBusy, setEditBusy] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionAttendance, setSessionAttendance] = useState([]);
  const [sessionForm, setSessionForm] = useState({ title: "", description: "", starts_at: "", join_url: "", domain_id: "" });
  const [feedbacks, setFeedbacks] = useState([]);
  const [grantExt, setGrantExt] = useState(null); // grant extra-time modal: { taskId, userId, name, week, taskTitle } — grants until an explicit date/time
  const [grantUntil, setGrantUntil] = useState(""); // grant modal: the extension deadline as a datetime-local string
  const [gradModal, setGradModal] = useState(null); // { id, name, best } — graduate + best-intern prompt
  const [gradBusy, setGradBusy] = useState(false);
  const [certBusy, setCertBusy] = useState(""); // `${userId}${certType}` while uploading
  const [resetPw, setResetPw] = useState(null); // founder password-reset modal: { id, name }
  const [resetPwValue, setResetPwValue] = useState("");
  const [resetPwConfirm, setResetPwConfirm] = useState("");
  const [resetPwErr, setResetPwErr] = useState("");
  const [resetPwBusy, setResetPwBusy] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false); // founder toggle: manual approval for new signups
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [viewMember, setViewMember] = useState(null); // signup-detail modal: a member row to inspect
  const [streaks, setStreaks] = useState({}); // user_id -> { current_streak, longest_streak, last_active, active_today, total_days }
  const [extAll, setExtAll] = useState([]);   // founder Weekly Task Report: ALL extension requests (any status)
  const [reportWeek, setReportWeek] = useState(""); // Weekly Task Report filter: "" = every week
  const [reportDept, setReportDept] = useState(""); // Weekly Task Report filter: "" = every department
  const [reportStatus, setReportStatus] = useState(""); // Weekly Task Report filter: "" = every status
  const [activeTab, setActiveTab] = useState("members");

  // Founder tier: a founder may moderate (ban) and delete/edit regular ADMIN accounts —
  // never another founder, never their own row. Regular admins keep managing students only.
  const iAmFounder = !!me?.is_founder;
  const canManageAdmin = (m) => iAmFounder && m.role === "admin" && !m.is_founder && m.id !== me?.id;
  const canModerate = (m) => m.role !== "admin" || canManageAdmin(m); // ban + edit/delete controls

  // Filtered views for the Members, Submissions, and founder User Records tables.
  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return members.filter((m) => {
      if (memberType === "student" && (m.role === "admin" || m.is_alumni)) return false;
      if (memberType === "admin" && m.role !== "admin") return false;
      if (memberType === "founder" && !m.is_founder) return false;
      if (memberType === "alumni" && !m.is_alumni) return false;
      if (memberDept && String(m.domain_id) !== String(memberDept)) return false;
      if (memberStatus === "banned" && !m.banned) return false;
      if (["approved", "pending", "rejected"].includes(memberStatus) && m.status !== memberStatus) return false;
      if (q && !(`${m.display_name || ""} ${m.full_name || ""} ${m.email || ""} ${m.member_id || ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [members, memberSearch, memberType, memberDept, memberStatus]);

  // Optional sort layered on top of the member filters — by name, country, or RAM tier.
  const sortedMembers = useMemo(() => {
    if (!memberSort) return filteredMembers;
    const ramRank = (r) => ({ "8GB": 8, "16GB": 16, "24GB": 24 }[r] || 0);
    const byName = (a, b) => (a.display_name || "").localeCompare(b.display_name || "");
    const arr = [...filteredMembers];
    if (memberSort === "name") {
      arr.sort(byName);
    } else if (memberSort === "country") {
      arr.sort((a, b) => {
        if (!a.country && !b.country) return byName(a, b);
        if (!a.country) return 1;   // members without a country go last
        if (!b.country) return -1;
        return a.country.localeCompare(b.country) || byName(a, b);
      });
    } else if (memberSort === "ram") {
      arr.sort((a, b) => (ramRank(b.ram) - ramRank(a.ram)) || byName(a, b)); // 24GB → 16GB → 8GB → none
    }
    return arr;
  }, [filteredMembers, memberSort]);

  const filteredSubs = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return subs.filter((s) => {
      if (subStatus && (s.status || "pending") !== subStatus) return false;
      if (q && !(`${s.profiles?.display_name || ""} ${s.tasks?.title || ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [subs, subSearch, subStatus]);

  const similarityFlags = useMemo(() => {
    const buckets = new Map();
    for (const s of subs) {
      if (!s.file_name || !s.task_id) continue;
      const normalized = normalizedSubmissionName(s.file_name);
      if (!normalized) continue;
      const key = `${s.task_id}:${normalized}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(s);
    }
    const flags = [];
    const flaggedIds = new Set();
    for (const rows of buckets.values()) {
      const students = new Set(rows.map((r) => r.user_id));
      if (students.size > 1) {
        flags.push({ type: "duplicate_name", severity: "high", rows, reason: "Same normalized filename on the same task across multiple interns." });
        rows.forEach((r) => flaggedIds.add(r.id));
      }
    }
    for (const s of subs) {
      if (flaggedIds.has(s.id)) continue; // already surfaced as a higher-severity duplicate
      const base = normalizedSubmissionName(s.file_name || "");
      if (base && base.length <= 6) {
        flags.push({ type: "generic_name", severity: "medium", rows: [s], reason: "Filename is too generic to audit confidently." });
      }
    }
    return flags.slice(0, 30);
  }, [subs]);

  const cohortHealth = useMemo(() => {
    const activeStudents = members.filter((m) => m.role === "student" && !m.is_alumni && !m.banned && (m.status || "approved") === "approved");
    const now = Date.now();
    const subByUserTask = new Map(subs.map((s) => [`${s.user_id}:${s.task_id}`, s]));
    const graded = subs.filter((s) => s.submitted_at && s.graded_at);
    const avgReviewHours = graded.length
      ? Math.round((graded.reduce((sum, s) => sum + Math.max(0, new Date(s.graded_at) - new Date(s.submitted_at)), 0) / graded.length) / 36_000) / 100
      : null;
    const approved = subs.filter((s) => s.status === "approved").length;
    const rejected = subs.filter((s) => s.status === "rejected").length;
    const pending = subs.filter((s) => s.status === "submitted").length;
    const atRisk = activeStudents.map((m) => {
      const eligibleTasks = tasks.filter((t) => (!t.domain_id || t.domain_id === m.domain_id) && (!t.ram || t.ram === m.ram));
      const userSubs = subs.filter((s) => s.user_id === m.id);
      const rejectedCount = userSubs.filter((s) => s.status === "rejected").length;
      const approvedCount = userSubs.filter((s) => s.status === "approved").length;
      const overdueMissing = eligibleTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now && !subByUserTask.has(`${m.id}:${t.id}`)).length;
      const score = overdueMissing * 2 + rejectedCount + (approvedCount === 0 && eligibleTasks.length ? 1 : 0);
      return { ...m, score, overdueMissing, rejectedCount, approvedCount, totalTasks: eligibleTasks.length };
    }).filter((m) => m.score >= 2).sort((a, b) => b.score - a.score).slice(0, 12);
    return {
      activeStudents: activeStudents.length,
      pending,
      approved,
      rejected,
      approvalRate: approved + rejected ? Math.round((approved / (approved + rejected)) * 100) : 0,
      avgReviewHours,
      atRisk,
    };
  }, [members, tasks, subs]);

  const reviewQueue = useMemo(() =>
    subs
      .filter((s) => s.status === "submitted")
      .map((s) => {
        const ageHours = s.submitted_at ? Math.max(0, Math.round((Date.now() - new Date(s.submitted_at).getTime()) / 36_000) / 100) : 0;
        const priority = ageHours >= 48 ? "urgent" : ageHours >= 24 ? "high" : "normal";
        return { ...s, ageHours, priority };
      })
      .sort((a, b) => b.ageHours - a.ageHours)
      .slice(0, 20),
    [subs]);

  const filteredRecords = useMemo(() => {
    const q = urSearch.trim().toLowerCase();
    return userRecords.filter((r) => {
      if (urStatus && r.status !== urStatus) return false;
      if (urDept && String(r.domain_id) !== String(urDept)) return false;
      if (q && !(`${r.member_id || ""} ${r.full_name || ""} ${r.display_name || ""} ${r.email || ""} ${r.discord_username || ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }, [userRecords, urSearch, urStatus, urDept]);

  // Late comers: interns whose signup time is after their department's earliest Week-1 task upload.
  // Computed live (no stored status), so existing users are covered too. Admin-only tag.
  const weekOneByDomain = useMemo(() => {
    const map = {};
    for (const t of tasks) {
      if (Number(t.week) !== 1 || !t.domain_id || !t.created_at) continue;
      if (!map[t.domain_id] || new Date(t.created_at) < new Date(map[t.domain_id])) map[t.domain_id] = t.created_at;
    }
    return map;
  }, [tasks]);
  const isLateComer = (m) =>
    m.role === "student" && !m.is_alumni && m.domain_id && m.created_at &&
    weekOneByDomain[m.domain_id] && new Date(m.created_at) > new Date(weekOneByDomain[m.domain_id]);

  // Weekly Task Report (founder view). For every task, resolve each intern to ONE standing so the
  // report can render as a single flat roster (not grouped by department):
  //   approved  — submission a grader approved
  //   rejected  — submission a grader rejected
  //   pending   — submission still awaiting review
  //   extension — no submission, but asked for extra time (any decision status)
  //   missing   — eligible, but neither submitted nor asked for extra time
  // A real submission always wins over an extension ask, which wins over "missing".
  // "Eligible" = every approved, non-alumni, non-banned intern in the task's department + RAM tier
  // (join date is intentionally ignored, so the report reflects the full active roster).
  // Anyone who actually submitted or requested an extension is always listed, even if outside that set.
  const weeklyReport = useMemo(() => {
    const memberById = new Map(members.map((m) => [m.id, m]));
    const activeStudentIds = new Set(
      members
        .filter((m) => m.role === "student" && !m.is_alumni && !m.banned && m.status !== "pending" && m.status !== "rejected")
        .map((m) => m.id)
    );
    const subsByTask = new Map();   // task_id -> Map(user_id -> submission)
    for (const s of subs) {
      if (!subsByTask.has(s.task_id)) subsByTask.set(s.task_id, new Map());
      subsByTask.get(s.task_id).set(s.user_id, s);
    }
    const extByTask = new Map();    // task_id -> Map(user_id -> latest request)
    for (const e of extAll) {
      if (!extByTask.has(e.task_id)) extByTask.set(e.task_id, new Map());
      const mm = extByTask.get(e.task_id);
      if (!mm.has(e.user_id)) mm.set(e.user_id, e); // extAll is newest-first → first seen is the latest
    }
    const nameOf = (m) => m?.display_name || m?.full_name || m?.email || (m?.member_id ? `#${m.member_id}` : "Unknown");
    const byName = (a, b) => a.name.localeCompare(b.name);

    return [...tasks]
      .sort((a, b) => (a.week - b.week) || (a.id - b.id))
      .map((t) => {
        const subMap = subsByTask.get(t.id) || new Map();
        const extMap = extByTask.get(t.id) || new Map();

        const eligibleIds = new Set();
        for (const id of activeStudentIds) {
          const m = memberById.get(id);
          if (!m) continue;
          if (t.domain_id && String(m.domain_id) !== String(t.domain_id)) continue; // domain-specific task
          if (t.ram && String(m.ram) !== String(t.ram)) continue; // RAM-tier task: only that tier is assigned it (mirrors the tasks_read RLS policy)
          eligibleIds.add(id);
        }

        const ids = new Set(eligibleIds);
        for (const uid of subMap.keys()) ids.add(uid);
        for (const uid of extMap.keys()) ids.add(uid);

        const roster = [];
        for (const uid of ids) {
          const m = memberById.get(uid);
          const name = nameOf(m);
          const sub = subMap.get(uid);
          const ext = extMap.get(uid);
          let status;
          if (sub) status = sub.status === "submitted" ? "pending" : sub.status; // approved / rejected / pending
          else if (ext) status = "extension"; // asked for time, hasn't submitted
          else status = "missing"; // eligible no-show
          roster.push({ id: uid, name, memberId: m?.member_id || null, deptId: m?.domain_id ?? null, status, extStatus: ext?.status || null, extendedUntil: ext?.extended_until || null });
        }
        roster.sort(byName);
        return { task: t, eligible: eligibleIds.size, roster };
      });
  }, [tasks, subs, extAll, members]);

  // Distinct week numbers present across the task list — powers the report's week filter.
  const reportWeeks = useMemo(
    () => [...new Set(tasks.map((t) => t.week))].sort((a, b) => a - b),
    [tasks]
  );

  // Flatten the per-task report into ONE roster (a row per intern per task) so the Weekly Task
  // Report renders as a single list instead of department-wise cards. Week/department filters are
  // applied here; the status filter is applied at render. Ordered by week, then name.
  const reportRoster = useMemo(
    () => weeklyReport
      .filter((r) =>
        (!reportWeek || String(r.task.week) === String(reportWeek)) &&
        (!reportDept || String(r.task.domain_id) === String(reportDept)))
      .flatMap((r) => r.roster.map((p) => ({ ...p, week: r.task.week, task: r.task })))
      .sort((a, b) => (a.week - b.week) || a.name.localeCompare(b.name)),
    [weeklyReport, reportWeek, reportDept]
  );

  // Weekly Task Report: clicking an intern's name opens the full-profile modal (reuses the
  // signup-detail modal — full name, email, phone w/ country code, country, department, etc.).
  const openProfile = (id) => {
    const m = members.find((x) => x.id === id);
    if (m) setViewMember(m);
  };

  // Format a timestamp as a <input type="datetime-local"> value (YYYY-MM-DDTHH:mm) in the viewer's zone.
  const toLocalInput = (ts) => {
    const d = ts ? new Date(ts) : new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  // Sensible starting deadline for the grant modal: an existing extension, else the task's due date
  // if it's still ahead, else a week from now — always a future value the founder can adjust.
  const defaultGrantUntil = (taskId, existing) => {
    if (existing) return toLocalInput(existing);
    const t = tasks.find((x) => x.id === taskId);
    const due = t?.due_at ? new Date(t.due_at) : null;
    const base = due && due > new Date() ? due : new Date(Date.now() + 7 * 86400000);
    return toLocalInput(base);
  };

  // Download the interns currently in the "No submission" list of the Weekly Task Report (respecting
  // its week/department filters) as a CSV of Full name, Email, and phone-with-country-code. Deduped by
  // intern, so someone missing across several weeks appears once.
  function downloadNoSubmissionCsv() {
    setErr(""); setOk("");
    const seen = new Set();
    const rows = [];
    for (const p of reportRoster) {
      if (p.status !== "missing" || seen.has(p.id)) continue;
      seen.add(p.id);
      const m = members.find((x) => x.id === p.id);
      const dial = m?.dial_code || (m?.country ? dialFor(m.country) : "");
      const phone = m?.phone ? `${dial ? dial + " " : ""}${m.phone}` : "";
      rows.push([m?.full_name || m?.display_name || p.name || "", m?.email || "", phone]);
    }
    if (rows.length === 0) return setErr("No interns are in the No-submission list for the current filters.");
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [["Full name", "Email", "Phone"], ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }); // BOM so Excel reads UTF-8
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `no-submission-interns-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setOk(`Downloaded ${rows.length} intern${rows.length === 1 ? "" : "s"} with no submission.`);
  }

  async function loadMembers() {
    const { data } = await supabase.from("profiles")
      .select("id,display_name,full_name,gender,email,role,banned,domain_id,timeout_until,status,payment_proof_url,payment_proof_submitted_at,payment_confirmed,is_alumni,ram,is_founder,country,dial_code,phone,discord_username,member_id,is_best_intern,certificate_key,lor_key,created_at")
      .order("created_at", { ascending: true });
    setMembers(data || []);
  }
  // Signup-approval mode (global): when ON, every new signup starts 'pending' and must be
  // accepted before they can enter; when OFF (default) new signups are auto-accepted and only
  // previously kicked emails are held. Backed by public.app_settings (migration 055).
  async function loadSettings() {
    const { data } = await supabase.from("app_settings").select("require_signup_approval").eq("id", true).maybeSingle();
    if (data) setRequireApproval(!!data.require_signup_approval);
  }
  async function toggleSignupApproval(next) {
    setErr(""); setOk(""); setApprovalBusy(true);
    const { error } = await supabase.rpc("set_signup_approval_mode", { p_require: next });
    setApprovalBusy(false);
    if (error) return setErr(error.message);
    setRequireApproval(next);
    setOk(next
      ? "Manual approval is ON — new interns now start as Pending until you Accept them."
      : "Auto-accept is ON — new interns are approved automatically (previously kicked emails still need approval).");
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
  async function loadLeaderboard() {
    const { data } = await supabase.rpc("global_message_counts", { p_limit: 25 });
    setLeaderboard(data || []);
  }
  async function loadExtensions() {
    // task_extension_requests has two FKs to profiles (user_id, decided_by) — disambiguate.
    const { data } = await supabase.from("task_extension_requests")
      .select("*, tasks(week,title), profiles!task_extension_requests_user_id_fkey(display_name,member_id,ram,domain_id)")
      .eq("status", "pending").order("created_at", { ascending: true });
    setExtReqs(data || []);
  }
  // Weekly Task Report needs EVERY extension request (approved/denied too), not just the pending
  // queue above. ter_select lets admins/founders read all rows; newest-first so the report keeps
  // the latest decision per (task, student).
  async function loadExtAll() {
    const { data } = await supabase.from("task_extension_requests")
      .select("task_id,user_id,status,extended_until,created_at")
      .order("created_at", { ascending: false });
    setExtAll(data || []);
  }
  // Founder-only: pending submission-change requests (a student wanting to replace a submission).
  // Two FKs to profiles (user_id, decided_by) — disambiguate the embed like the extension queue.
  async function loadChangeRequests() {
    if (!iAmFounder) return;
    const { data } = await supabase.from("submission_change_requests")
      .select("*, tasks(week,title), profiles!submission_change_requests_user_id_fkey(display_name,member_id,ram,domain_id)")
      .eq("status", "pending").order("created_at", { ascending: true });
    setChangeReqs(data || []);
  }
  async function decideChangeRequest(id, approve) {
    setErr(""); setOk("");
    const row = changeReqs.find((r) => r.id === id);
    const { error } = await supabase.rpc("founder_decide_change_request", { p_request_id: id, p_approve: approve });
    if (error) return setErr(error.message);
    if (row?.user_id) {
      notifyUser(
        row.user_id,
        approve ? "Change request approved — ZeroDay Reapers" : "Change request declined — ZeroDay Reapers",
        approve
          ? `<p>Your request to change your submission for <b>Week ${row.tasks?.week} · ${row.tasks?.title || "your task"}</b> was <b>approved</b>. You can now upload a new version once from your Tasks tab.</p>`
          : `<p>Your request to change your submission for <b>Week ${row.tasks?.week} · ${row.tasks?.title || "your task"}</b> was <b>declined</b>. Reach out to your mentor if you have questions.</p>`
      );
    }
    setOk(approve ? "Change request approved — the student can now re-upload once." : "Change request denied.");
    loadChangeRequests();
  }
  async function decideExtension(id, approve, days = 0) {
    setErr(""); setOk("");
    if (approve) {
      const n = parseInt(days, 10);
      if (!Number.isFinite(n) || n < 1) return setErr("Enter a valid number of days.");
      days = n;
    }
    const { error } = await supabase.rpc("admin_decide_extension", { p_request_id: id, p_approve: approve, p_extra_days: approve ? days : 0 });
    if (error) return setErr(error.message);
    setGrantExt(null);
    setOk(approve ? `Granted ${days} extra day(s).` : "Extension denied.");
    loadExtensions();
    loadExtAll();
  }
  // Founder-initiated: grant a specific intern an extension on a specific task until an explicit
  // date/time (admin_grant_extension approves an existing pending request or creates an approved row).
  async function grantExtensionUntil(taskId, userId, untilLocal) {
    setErr(""); setOk("");
    if (!untilLocal) return setErr("Pick a date and time for the extension.");
    const until = new Date(untilLocal); // datetime-local is parsed in the viewer's local zone
    if (isNaN(until.getTime())) return setErr("Enter a valid date and time.");
    if (until <= new Date()) return setErr("The extension deadline must be in the future.");
    const { error } = await supabase.rpc("admin_grant_extension", { p_task_id: taskId, p_user_id: userId, p_until: until.toISOString() });
    if (error) return setErr(error.message);
    setGrantExt(null);
    setOk(`Extension granted until ${fmtLocalAndPKT(until.toISOString())}.`);
    loadExtAll();
    loadExtensions();
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

  async function loadSessions() {
    const { data } = await supabase.from("live_sessions").select("*").order("starts_at", { ascending: true });
    setSessions(data || []);
  }
  async function loadSessionAttendance() {
    const { data } = await supabase.from("live_session_attendance").select("session_id,status,user_id");
    setSessionAttendance(data || []);
  }
  async function loadIssues() {
    const { data } = await supabase.from("portal_issues")
      .select("*")
      .order("created_at", { ascending: false }).limit(200);
    setIssues(data || []);
  }
  // Founder-only: consolidated record of every user's saved signup/profile data.
  // Loaded through an RPC instead of an exposed auth.users-backed view.
  async function loadUserRecords() {
    if (!iAmFounder) return;
    const { data, error } = await supabase.rpc("get_founder_user_records");
    if (error) {
      setUserRecords([]);
      return;
    }
    setUserRecords(data || []);
  }
  async function setIssueStatus(id, status) {
    setErr(""); setOk("");
    const { error } = await supabase.rpc("admin_set_issue_status", { p_id: id, p_status: status });
    if (error) return setErr(error.message);
    setOk(`Issue ${status}.`);
    loadIssues();
  }
  async function createSession(e) {
    e.preventDefault();
    setErr(""); setOk("");
    if (!sessionForm.title.trim() || !sessionForm.starts_at) return setErr("Session needs a title and start time.");
    const { error } = await supabase.from("live_sessions").insert({
      title: sessionForm.title.trim(),
      description: sessionForm.description.trim() || null,
      starts_at: pktLocalInputToISO(sessionForm.starts_at),
      join_url: sessionForm.join_url.trim() || null,
      domain_id: sessionForm.domain_id ? Number(sessionForm.domain_id) : null,
      created_by: me.id,
    });
    if (error) return setErr(error.message);
    setSessionForm({ title: "", description: "", starts_at: "", join_url: "", domain_id: "" });
    setOk("Live session scheduled.");
    loadSessions();
    loadSessionAttendance();
  }
  async function deleteSession(id) {
    await supabase.from("live_sessions").delete().eq("id", id);
    loadSessions();
  }
  async function loadFeedback() {
    const { data } = await supabase.from("feedback")
      .select("*, profiles!feedback_user_id_fkey(display_name,domain_id)")
      .order("created_at", { ascending: false });
    setFeedbacks(data || []);
  }
  async function setFeedbackStatus(id, status) {
    setErr(""); setOk("");
    const { error } = await supabase.rpc("admin_set_feedback_status", { p_id: id, p_status: status });
    if (error) return setErr(error.message);
    setOk(`Testimonial ${status}.`);
    loadFeedback();
  }

  async function loadStreaks() {
    const { data } = await supabase.rpc("get_login_streaks");
    setStreaks(Object.fromEntries((data || []).map((r) => [r.user_id, r])));
  }

  useEffect(() => {
    supabase.from("domains").select("id,name,key").order("sort").then(({ data }) => setDomains(data || []));
    loadMembers();
    loadStreaks();
    loadAnn();
    loadTasks();
    loadSubs();
    loadAudit();
    loadReports();
    loadLeaderboard();
    loadExtensions();
    loadExtAll();
    loadChangeRequests();
    loadSessions();
    loadFeedback();
    loadIssues();
    loadUserRecords();
    loadSettings();
  }, []);

  // Live-refresh members + founder User Records whenever a profile is created/changed (e.g. a new
  // signup). Requires public.profiles in the Realtime publication (migration 040); without it this
  // simply never fires and the lists still refresh on each Admin Panel open.
  useEffect(() => {
    const ch = supabase.channel("admin-profiles")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        loadMembers();
        loadUserRecords();
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [iAmFounder]);

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
    if (newStatus === "approved" || newStatus === "rejected") {
      notifyUser(
        userId,
        newStatus === "approved" ? "You're approved — ZeroDay Reapers" : "Application update — ZeroDay Reapers",
        newStatus === "approved"
          ? "<p>Good news — your ZeroDay Reapers account has been <b>approved</b>. Log in to access your department chat, tasks, and more.</p>"
          : "<p>Thanks for applying to ZeroDay Reapers. Unfortunately your application was <b>not approved</b> at this time.</p>"
      );
    }
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
  // Founder-only: set a new password for an intern without their current one (founder_reset_password RPC).
  function openResetPw(m) {
    setResetPwErr(""); setResetPwValue(""); setResetPwConfirm("");
    setResetPw({ id: m.id, name: m.display_name });
  }
  async function submitResetPw() {
    if (!resetPw) return;
    setResetPwErr("");
    const failed = PW_RULES.filter((r) => !r.test(resetPwValue));
    if (failed.length) return setResetPwErr("Password must include: " + failed.map((f) => f.label).join(", ") + ".");
    if (resetPwValue !== resetPwConfirm) return setResetPwErr("Passwords do not match.");
    setResetPwBusy(true);
    const { error } = await supabase.rpc("founder_reset_password", { target: resetPw.id, new_password: resetPwValue });
    setResetPwBusy(false);
    if (error) return setResetPwErr(error.message);
    const name = resetPw.name;
    setResetPw(null); setResetPwValue(""); setResetPwConfirm("");
    setOk(`Password reset for ${name}. Share the new password with them securely — they can change it after signing in.`);
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
    if (graduated) {
      notifyUser(
        userId,
        "🎓 Certificate ready — ZeroDay Reapers",
        `<p>Congratulations ${name}! You've completed the internship and graduated to Alumni. Your completion certificate is ready — check the portal and your email for details.</p>`
      );
    }
    setOk(`Updated alumni status for ${name}.`);
    loadMembers();
  }
  // Graduate flow with an optional "Best Intern" mark (prompted when tasks are complete).
  function openGraduate(m) { setGradModal({ id: m.id, name: m.display_name, best: !!m.is_best_intern }); }
  async function confirmGraduate() {
    if (!gradModal) return;
    setErr(""); setOk(""); setGradBusy(true);
    if (gradModal.best) {
      const { error: bErr } = await supabase.rpc("admin_set_best_intern", { target: gradModal.id, val: true });
      if (bErr) { setGradBusy(false); return setErr(bErr.message); }
    }
    const { error } = await supabase.rpc("admin_set_alumni", { target: gradModal.id, graduated: true });
    setGradBusy(false);
    if (error) return setErr(error.message);
    notifyUser(gradModal.id, "🎓 You've graduated — ZeroDay Reapers",
      `<p>Congratulations ${gradModal.name}! You've completed the internship and graduated to Alumni.${gradModal.best ? " You were recognized as a <b>Best Intern</b> 🏆." : ""} Your certificate will be available on your dashboard.</p>`);
    setGradModal(null);
    setOk(`${gradModal.name} graduated to Alumni.`);
    loadMembers();
  }
  async function toggleBestIntern(userId, val, name) {
    setErr(""); setOk("");
    const { error } = await supabase.rpc("admin_set_best_intern", { target: userId, val });
    if (error) return setErr(error.message);
    setOk(val ? `${name} marked as Best Intern 🏆` : `Removed Best Intern from ${name}.`);
    loadMembers();
  }
  // Admin uploads an alumni's certificate / LOR into their own R2 folder, then records the key.
  async function uploadCertificate(m, file, certType) {
    if (!file) return;
    setErr(""); setOk(""); setCertBusy(m.id + certType);
    try {
      const { key } = await uploadToR2(file, { kind: "certificate", targetUid: m.id, certType });
      const args = certType === "lor"
        ? { target: m.id, p_certificate_key: null, p_lor_key: key }
        : { target: m.id, p_certificate_key: key, p_lor_key: null };
      const { error } = await supabase.rpc("admin_set_certificate", args);
      if (error) throw new Error(error.message);
      setOk(`Uploaded ${certType === "lor" ? "LOR" : "certificate"} for ${m.display_name}.`);
      loadMembers();
    } catch (e) { setErr(e.message); }
    finally { setCertBusy(""); }
  }
  const approvedCount = (userId) => subs.filter((s) => s.user_id === userId && s.status === "approved").length;
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

  async function changePassword(e) {
    e.preventDefault();
    setErr(""); setOk("");
    const failed = PW_RULES.filter((r) => !r.test(pw));
    if (failed.length) return setErr("Password must include: " + failed.map((f) => f.label).join(", ") + ".");
    if (pw !== pwConfirm) return setErr("Passwords do not match.");
    setPwBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw });
    setPwBusy(false);
    if (error) return setErr(error.message);
    setPw(""); setPwConfirm("");
    setOk("🔒 Password updated. Signing you out of all devices…");
    supabase.from("profiles").update({ password_changed_at: new Date().toISOString() }).eq("id", me.id);
    supabase.rpc("log_my_activity", { p_type: "password_changed" });
    emailSelf("Your ZeroDay Reapers password was changed",
      "<p>Your account password was just changed. If this wasn't you, reset it immediately and contact us.</p>");
    setTimeout(() => supabase.auth.signOut({ scope: "global" }), 1200);
  }

  function openEditMember(m) {
    setEditMember({ id: m.id, display_name: m.display_name || "", full_name: m.full_name || "", gender: m.gender || "", country: m.country || "", member_id: m.member_id || "" });
  }
  async function saveMemberProfile() {
    if (!editMember) return;
    setErr(""); setOk("");
    if (!editMember.full_name.trim()) return setErr("Full name is required.");
    setEditBusy(true);
    const { error } = await supabase.rpc("admin_update_profile", {
      target: editMember.id,
      p_display_name: editMember.display_name.trim() || editMember.full_name.trim(),
      p_full_name: editMember.full_name.trim(),
      p_gender: editMember.gender,
      p_country: editMember.country || "",
      p_dial_code: editMember.country ? dialFor(editMember.country) : "",
      p_member_id: editMember.member_id.trim(),
    });
    setEditBusy(false);
    if (error) return setErr(error.message);
    setEditMember(null);
    setOk("Member profile updated.");
    loadMembers();
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
        due_at: pktLocalInputToISO(taskForm.due_at),
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

      broadcastEmail(
        { domainId, ram: taskForm.ram || null },
        `New task assigned — Week ${Number(taskForm.week)} — ZeroDay Reapers`,
        `<p>A new task has been assigned: <b>Week ${Number(taskForm.week)} · ${taskForm.title.trim()}</b>.</p><p>Log in to the portal Tasks tab to view the instructions and submit your deliverable.</p>`
      );
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
  // Open the grade dialog (canned-feedback picker + editable note).
  function gradeSub(sub, status) {
    setErr("");
    setFbText("");
    setScores({ completeness: "", accuracy: "", evidence: "", report: "" });
    setGrading({ sub, status });
  }
  async function submitGrade() {
    if (!grading) return;
    const { sub, status } = grading;
    const fb = fbText.trim();
    // Rubric marks apply only on approve; blanks → null, everything else clamped to 0..10.
    const parseScore = (v) => {
      if (v === "" || v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n * 100) / 100)) : null;
    };
    const marks = status === "approved"
      ? { score_completeness: parseScore(scores.completeness), score_accuracy: parseScore(scores.accuracy), score_evidence: parseScore(scores.evidence), score_report: parseScore(scores.report) }
      : { score_completeness: null, score_accuracy: null, score_evidence: null, score_report: null };
    const base = { status, feedback: fb || null, graded_by: me.id, graded_at: new Date().toISOString() };
    // Try with the rubric marks; if those columns aren't on the DB yet (migrations 047/051 not run),
    // don't block grading — retry with just status/feedback and flag that the marks weren't stored.
    let marksSkipped = false;
    const { error } = await supabase.from("submissions").update({ ...base, ...marks }).eq("id", sub.id);
    if (error) {
      const retry = await supabase.from("submissions").update(base).eq("id", sub.id);
      if (retry.error) return setErr(retry.error.message || error.message);
      marksSkipped = true;
    }
    // First Blood is now posted server-side to the read-only Milestones feed by the emit_first_blood
    // trigger (migration 053) — this keeps it out of Announcements and off the client.
    setGrading(null);
    loadSubs();
    if (marksSkipped) setErr("Grade saved, but rubric marks weren't stored — run migrations 047 & 051 on the database, then re-grade to record the marks.");
    // best-effort email to the student (no-op if Resend key isn't configured)
    const wk = sub.tasks?.week, title = sub.tasks?.title || "your task";
    const subject = `Task ${status === "approved" ? "approved ✅" : "needs changes"} — ZeroDay Reapers`;
    const html = `<p>Hi,</p><p>Your submission for <b>Week ${wk} · ${title}</b> was <b>${status}</b>.</p>`
      + (fb ? `<p><b>Mentor feedback:</b> ${fb}</p>` : "")
      + `<p>— ZeroDay Reapers</p>`;
    notifyUser(sub.user_id, subject, html);
  }
  async function downloadSub(key) {
    if (!key) return;
    try { await downloadFromR2(key); } catch (e) { setErr(e.message); }
  }

  // Payment proofs are private R2 keys (presigned download); legacy values are old public URLs.
  async function openProof(val) {
    if (!val) return;
    if (/^https?:\/\//.test(val)) { window.open(val, "_blank", "noopener"); return; }
    try { await downloadFromR2(val); } catch (e) { setErr(e.message); }
  }

  function toggleSelect(id) {
    setSelectedSubs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  async function bulkApprove() {
    const ids = [...selectedSubs];
    if (!ids.length) return;
    setErr(""); setOk("");
    const { data, error } = await supabase.rpc("admin_bulk_approve_submissions", { ids });
    if (error) return setErr(error.message);
    setSelectedSubs(new Set());
    setOk(`Approved ${data ?? ids.length} submission(s).`);
    loadSubs();
  }
  async function openHistory(s) {
    const { data } = await supabase.from("submission_files")
      .select("*").eq("task_id", s.task_id).eq("user_id", s.user_id)
      .order("uploaded_at", { ascending: false });
    setHistory({ sub: s, files: data || [] });
  }
  function exportFeedbackReport(s) {
    const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const overall = s.score_overall != null ? `${gradeValue(s.score_overall)} / 40` : "Not scored";
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Feedback - ${esc(s.profiles?.display_name || "student")}</title><style>
      body{font-family:Arial,sans-serif;max-width:760px;margin:40px auto;color:#111;line-height:1.5}
      h1{font-size:22px;margin:0 0 8px}.muted{color:#666;font-size:13px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:18px 0}
      .box{border:1px solid #ddd;padding:12px}.score{font-size:20px;font-weight:700}.feedback{white-space:pre-wrap;border-left:4px solid #e10600;padding-left:14px}
    </style></head><body>
      <h1>ZeroDay Reapers - Task Feedback</h1>
      <p class="muted">Student: ${esc(s.profiles?.display_name || "Student")} | Task: Week ${esc(s.tasks?.week)} - ${esc(s.tasks?.title || "Task")} | Status: ${esc(s.status)}</p>
      <div class="box"><div class="muted">Overall</div><div class="score">${esc(overall)}</div></div>
      <div class="grid">
        <div class="box">Completeness<br><b>${esc(gradeValue(s.score_completeness))}/10</b></div>
        <div class="box">Accuracy<br><b>${esc(gradeValue(s.score_accuracy))}/10</b></div>
        <div class="box">Evidence<br><b>${esc(gradeValue(s.score_evidence))}/10</b></div>
        <div class="box">Report quality<br><b>${esc(gradeValue(s.score_report))}/10</b></div>
      </div>
      <h2>Mentor Feedback</h2>
      <p class="feedback">${esc(s.feedback || "No written feedback provided.")}</p>
    </body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zdr-feedback-week-${s.tasks?.week || "task"}-${s.profiles?.display_name || "student"}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function postAnn(e) {
    e.preventDefault();
    setErr("");
    if (!ann.title.trim() || !ann.body.trim()) return;
    setAnnBusy(true);
    try {
      let attachment_key = null, attachment_name = null;
      if (annFile) {
        const up = await uploadToR2(annFile, { kind: "announcement" });
        attachment_key = up.key; attachment_name = up.name;
      }
      const link = ann.link.trim();
      const { error } = await supabase.from("announcements").insert({
        title: ann.title.trim(), body: ann.body.trim(),
        link_url: link || null, attachment_key, attachment_name,
      });
      if (error) { setErr(error.message); return; }
      if (annEmail) {
        broadcastEmail(
          {},
          "New announcement — ZeroDay Reapers",
          `<p><b>${ann.title.trim()}</b></p><p>${ann.body.trim()}</p>${link ? `<p><a href="${link}">${link}</a></p>` : ""}<p>Log in to the portal to read more.</p>`
        );
      }
      setAnn({ title: "", body: "", link: "" });
      setAnnFile(null);
      loadAnn();
    } catch (e2) {
      setErr(e2.message || "Could not post announcement.");
    } finally {
      setAnnBusy(false);
    }
  }
  async function delAnn(id) {
    await supabase.from("announcements").delete().eq("id", id);
    loadAnn();
  }

  const input = "panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-sm";
  const pendingApprovals = members.filter((m) => m.status === "pending" && m.role !== "admin").length;
  const pendingSubs = subs.filter((s) => s.status === "submitted").length;
  const openModeration = issues.filter((i) => i.status === "open").length + reports.filter((r) => !r.resolved).length;
  const founderQueue = iAmFounder ? changeReqs.length + reportRoster.filter((p) => p.status === "missing").length : 0;
  const tabs = [
    { id: "members", label: "Members", count: pendingApprovals },
    { id: "review", label: "Tasks & Review", count: pendingSubs + extReqs.length },
    iAmFounder ? { id: "founder", label: "Founder", count: founderQueue } : null,
    { id: "comms", label: "Comms", count: announcements.length + sessions.length },
    { id: "moderation", label: "Moderation", count: openModeration },
    { id: "profile", label: "Settings", count: 0 },
  ].filter(Boolean);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-black/60 backdrop-blur-xl border-b border-blood/25">
        <div className="w-full flex items-center justify-between px-4 sm:px-6 py-3">
          <span className="font-mono text-sm tracking-widest text-white text-glow truncate min-w-0">ADMIN · ZERO<span className="text-blood">DAY</span> REAPERS</span>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back to chat
          </button>
        </div>
        <nav className="w-full px-4 sm:px-6 pb-3 overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max">
            {tabs.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`font-mono text-[11px] uppercase tracking-widest border px-3 py-2 rounded-sm transition inline-flex items-center gap-2 ${active ? "border-blood bg-blood/15 text-white" : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"}`}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className={`rounded-sm px-1.5 py-0.5 text-[10px] ${active ? "bg-blood text-white" : "bg-ink-800 text-blood"}`}>
                      {tab.count > 99 ? "99+" : tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </nav>
      </header>

      <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-8">
        {err && <p className="font-mono text-sm text-blood">{err}</p>}
        {ok && <p className="font-mono text-sm text-[#34d399]">{ok}</p>}

        {/* My profile */}
        {activeTab === "profile" && me && (
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
              <button onClick={saveName} className="btn-neon font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition">
                Save
              </button>
              {me.email && <span className="font-mono text-xs text-neutral-600">{me.email} · admin</span>}
            </div>

            <form onSubmit={changePassword} className="mt-5 flex items-end gap-3 flex-wrap">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">New password</label>
                <PasswordInput className={`${input} w-56`} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Min 12 characters" autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">Confirm password</label>
                <PasswordInput className={`${input} w-56`} value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} placeholder="Re-enter" autoComplete="new-password" />
              </div>
              <button type="submit" disabled={pwBusy || !pw} className="btn-neon font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
                {pwBusy ? "…" : "Change Password"}
              </button>
            </form>
          </section>
        )}

        {/* Members */}
        {activeTab === "members" && <section>
          {/* Founder-only: choose how new signups are handled — auto-accept (default) or manual approval. */}
          {iAmFounder && (
            <div className="mb-6 p-4 border border-blood/25 rounded-sm bg-ink-900/40">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <h3 className="font-mono text-sm uppercase tracking-widest text-white flex items-center gap-2 flex-wrap">
                    <span>🛂 New Signup Approval</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-sm border ${requireApproval ? "border-amber-500/40 bg-amber-500/15 text-amber-400" : "border-[#34d399]/40 bg-[#34d399]/10 text-[#34d399]"}`}>
                      {requireApproval ? "Manual approval" : "Auto-accept"}
                    </span>
                  </h3>
                  <p className="font-mono text-[11px] text-neutral-500 mt-1 leading-relaxed max-w-xl">
                    {requireApproval
                      ? "Every new intern who signs up starts as Pending and can't enter the portal until you Accept them below."
                      : "New interns are approved automatically the moment they sign up. Only previously kicked/removed emails are held for approval."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={requireApproval}
                  disabled={approvalBusy}
                  onClick={() => toggleSignupApproval(!requireApproval)}
                  title={requireApproval ? "Turn off manual approval (auto-accept new signups)" : "Turn on manual approval for new signups"}
                  className={`relative inline-flex h-7 w-14 shrink-0 items-center rounded-full border transition disabled:opacity-50 ${requireApproval ? "bg-amber-500/30 border-amber-500" : "bg-neutral-800 border-neutral-600"}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full transition ${requireApproval ? "translate-x-8 bg-amber-400" : "translate-x-1 bg-neutral-400"}`} />
                </button>
              </div>
            </div>
          )}

          {pendingApprovals > 0 && (
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
                    <div key={m.id} className="panel border border-amber-500/30 p-3 rounded-sm flex flex-col justify-between gap-3">
                      <div>
                        <div className="font-mono text-sm text-white font-bold truncate">{m.display_name}</div>
                        <div className="font-mono text-xs text-neutral-400 truncate">{m.email}</div>
                        <button
                          onClick={() => setViewMember(m)}
                          className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-[#38bdf8] hover:underline inline-flex items-center gap-1"
                        >
                          🔍 View full details
                        </button>
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

          {/* Daily login streaks — who's showing up (PKT day boundary) */}
          {(() => {
            const rows = members
              .filter((m) => m.role === "student" && !m.is_alumni && !m.banned)
              .map((m) => ({ m, s: streaks[m.id] }))
              .sort((a, b) => ((b.s?.active_today ? 1 : 0) - (a.s?.active_today ? 1 : 0)) || ((b.s?.current_streak || 0) - (a.s?.current_streak || 0)));
            const activeToday = rows.filter((r) => r.s?.active_today).length;
            const onStreak = rows.filter((r) => (r.s?.current_streak || 0) >= 2).length;
            return (
              <div className="mb-6 border border-blood/20 rounded-sm bg-ink-900/30 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <h3 className="font-mono text-sm uppercase tracking-widest text-white flex items-center gap-2">🔥 Daily Login Streaks</h3>
                    <p className="font-mono text-[11px] text-neutral-500 mt-1 max-w-xl leading-relaxed">Who's showing up on the portal each day. A day is a Pakistan (PKT) calendar day; a streak stays alive until a full day is missed.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] uppercase tracking-widest border border-[#34d399]/40 text-[#34d399] rounded-sm px-2 py-1">{activeToday} active today</span>
                    <span className="font-mono text-[10px] uppercase tracking-widest border border-amber-500/40 text-amber-400 rounded-sm px-2 py-1">{onStreak} on a streak</span>
                  </div>
                </div>
                {rows.length === 0 ? (
                  <p className="font-mono text-xs text-neutral-500">No interns yet.</p>
                ) : (
                  <div className="max-h-72 overflow-y-auto divide-y divide-blood/10 border border-blood/10 rounded-sm">
                    {rows.map(({ m, s }) => (
                      <button key={m.id} type="button" onClick={() => openProfile(m.id)} className="w-full text-left px-3 py-2 hover:bg-ink-900/60 transition flex items-center justify-between gap-3">
                        <span className="min-w-0 flex items-start gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${s?.active_today ? "bg-[#34d399]" : (s?.current_streak || 0) > 0 ? "bg-amber-400" : "bg-neutral-700"}`} />
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-sm text-white truncate">{m.display_name || m.full_name || "Intern"}</span>
                              {m.member_id && <span className="font-mono text-[10px] text-neutral-600 truncate hidden sm:inline">{m.member_id}</span>}
                            </span>
                            <span className="block font-mono text-[10px] text-neutral-500 mt-0.5 truncate">Last sign-in {fmtDT(s?.last_login)} · active {fmtDT(s?.last_active_at)}</span>
                          </span>
                        </span>
                        <span className="font-mono text-[11px] shrink-0 flex items-center gap-3">
                          <span className={(s?.current_streak || 0) > 0 ? "text-white" : "text-neutral-600"}>🔥 {s?.current_streak || 0}d</span>
                          <span className="text-neutral-600 hidden sm:inline">longest {s?.longest_streak || 0}</span>
                          <span className="text-neutral-500 w-16 text-right">{streakDaysAgo(s?.last_active)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h2 className="font-mono text-xl text-white">Members ({filteredMembers.length}{filteredMembers.length !== members.length ? ` / ${members.length}` : ""})</h2>
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
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <input className={input + " flex-1 min-w-[180px]"} placeholder="Search name, email, or member ID…" value={memberSearch} onChange={(e) => setMemberSearch(e.target.value)} />
            <select className={input} value={memberType} onChange={(e) => setMemberType(e.target.value)}>
              <option value="">All types</option>
              <option value="student">Students</option>
              <option value="admin">Admins</option>
              <option value="founder">Founders</option>
              <option value="alumni">Alumni</option>
            </select>
            <select className={input} value={memberDept} onChange={(e) => setMemberDept(e.target.value)}>
              <option value="">All departments</option>
              {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select className={input} value={memberStatus} onChange={(e) => setMemberStatus(e.target.value)}>
              <option value="">Any status</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="rejected">Rejected</option>
              <option value="banned">Banned</option>
            </select>
            <select className={input} value={memberSort} onChange={(e) => setMemberSort(e.target.value)} title="Sort members">
              <option value="">Sort: default</option>
              <option value="name">Sort: name (A–Z)</option>
              <option value="country">Sort: country</option>
              <option value="ram">Sort: RAM tier</option>
            </select>
            {(memberSearch || memberType || memberDept || memberStatus || memberSort) && (
              <button onClick={() => { setMemberSearch(""); setMemberType(""); setMemberDept(""); setMemberStatus(""); setMemberSort(""); }}
                className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-400 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">Clear</button>
            )}
          </div>
          <div className="overflow-x-auto border border-blood/20 rounded-sm max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm font-mono">
              <thead className="panel text-neutral-500 uppercase text-xs tracking-widest sticky top-0 z-10">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Joined</th>
                  <th className="text-left px-4 py-3">Streak</th>
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
                {filteredMembers.length === 0 ? (
                  <tr><td colSpan={11} className="px-4 py-6 text-center text-neutral-500 text-xs italic">No members match your filters.</td></tr>
                ) : sortedMembers.map((m) => (
                  <tr key={m.id} className="border-t border-blood/10">
                    <td className="px-4 py-3 text-white">
                      {isLateComer(m) && <span className="text-amber-400 text-[10px] font-semibold px-1 py-0.5 rounded-sm bg-amber-500/10 mr-1 align-middle" title="Signed up after their department's Week 1 task — late comer">⏱ Late</span>}
                      {m.display_name} {m.country && <Flag code={m.country} />} {m.is_alumni && <span className="text-[#38bdf8] ml-1" title="Alumni">🎓</span>} {m.is_founder ? <span className="text-amber-400 text-xs font-semibold" title="Founder">👑 Founder</span> : m.role === "admin" && <span className="text-blood text-xs font-semibold">(admin)</span>}
                      {m.member_id && <div className="text-[10px] text-neutral-500 font-mono tracking-wider mt-0.5">{m.member_id}</div>}
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{m.email}</td>
                    <td className="px-4 py-3 text-neutral-500 whitespace-nowrap text-xs">{fmtLocalAndPKT(m.created_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{m.role === "admin" ? <span className="text-neutral-600 text-xs">—</span> : <StreakBadge s={streaks[m.id]} />}</td>
                    <td className="px-4 py-3">
                      {m.role === "admin" ? (
                        <span className="text-blood uppercase text-xs tracking-widest font-semibold">{m.is_founder ? "Founder" : "Admin"}</span>
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
                      {!canModerate(m) ? (
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
                            <button
                              type="button"
                              onClick={() => openProof(m.payment_proof_url)}
                              className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider bg-[#34d399]/20 border border-[#34d399] text-[#34d399] px-2.5 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition font-bold"
                            >
                              <span>📄 Proof</span>
                              <span className="text-[9px]">↗</span>
                            </button>
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
                      {m.role !== "admin" ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditMember(m)}
                            title="Edit profile (name, gender)"
                            className="text-xs uppercase tracking-widest border border-neutral-600 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-blood hover:text-blood transition font-medium"
                          >
                            Edit
                          </button>
                          {m.is_alumni ? (
                            <button
                              onClick={() => toggleAlumni(m.id, false, m.display_name)}
                              title="Revoke Alumni Status"
                              className="text-xs uppercase tracking-widest border border-[#38bdf8] bg-[#38bdf8]/20 text-[#38bdf8] px-3 py-1.5 rounded-sm transition font-medium"
                            >
                              🎓 Alumni
                            </button>
                          ) : (
                            <button
                              onClick={() => openGraduate(m)}
                              title="Graduate to Alumni Group"
                              className={`text-xs uppercase tracking-widest border px-3 py-1.5 rounded-sm transition font-medium ${approvedCount(m.id) >= 6 ? "border-[#34d399] bg-[#34d399]/20 text-[#34d399] animate-pulse" : "border-neutral-600 text-neutral-300 hover:border-[#38bdf8] hover:text-[#38bdf8]"}`}
                            >
                              {approvedCount(m.id) >= 6 ? "🎓 Ready — Graduate" : "Graduate 🎓"}
                            </button>
                          )}
                          <button
                            onClick={() => toggleBestIntern(m.id, !m.is_best_intern, m.display_name)}
                            title={m.is_best_intern ? "Remove Best Intern" : "Mark as Best Intern (max 3 per dept)"}
                            className={`text-xs uppercase tracking-widest border px-3 py-1.5 rounded-sm transition font-medium ${m.is_best_intern ? "border-amber-500 bg-amber-500/20 text-amber-400" : "border-neutral-600 text-neutral-300 hover:border-amber-500 hover:text-amber-400"}`}
                          >
                            {m.is_best_intern ? "🏆 Best" : "🏆 Best?"}
                          </button>
                          {m.is_alumni && (
                            <>
                              <label className={`text-xs uppercase tracking-widest border border-neutral-600 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-blood hover:text-blood transition font-medium cursor-pointer ${certBusy === m.id + "certificate" ? "opacity-50" : ""}`} title="Upload certificate (PDF)">
                                {m.certificate_key ? "📄 Cert ✓" : "📄 Cert"}
                                <input type="file" accept=".pdf" className="hidden" onChange={(e) => uploadCertificate(m, e.target.files?.[0], "certificate")} />
                              </label>
                              <label className={`text-xs uppercase tracking-widest border border-neutral-600 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-amber-500 hover:text-amber-400 transition font-medium cursor-pointer ${certBusy === m.id + "lor" ? "opacity-50" : ""}`} title="Upload Letter of Recommendation (PDF)">
                                {m.lor_key ? "✉ LOR ✓" : "✉ LOR"}
                                <input type="file" accept=".pdf" className="hidden" onChange={(e) => uploadCertificate(m, e.target.files?.[0], "lor")} />
                              </label>
                            </>
                          )}
                          {iAmFounder && (
                            <button
                              onClick={() => openResetPw(m)}
                              title="Reset this intern's password (founder only — no current password needed)"
                              className="text-xs uppercase tracking-widest border border-amber-500/70 text-amber-400 px-3 py-1.5 rounded-sm hover:bg-amber-500 hover:text-ink-950 transition font-medium"
                            >
                              🔑 Reset PW
                            </button>
                          )}
                          <button
                            onClick={() => deleteMember(m.id, m.display_name)}
                            title="Permanently delete account"
                            className="text-xs uppercase tracking-widest border border-red-600/70 text-red-400 px-3 py-1.5 rounded-sm hover:bg-red-600 hover:text-white transition font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      ) : canManageAdmin(m) ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openEditMember(m)}
                            title="Edit admin profile (name, gender)"
                            className="text-xs uppercase tracking-widest border border-neutral-600 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-blood hover:text-blood transition font-medium"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteMember(m.id, m.display_name)}
                            title="Permanently delete this admin account"
                            className="text-xs uppercase tracking-widest border border-red-600/70 text-red-400 px-3 py-1.5 rounded-sm hover:bg-red-600 hover:text-white transition font-medium"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <span className="text-neutral-600 text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>}

        {/* Tasks */}
        {activeTab === "review" && <section>
          <h2 className="font-mono text-xl text-white mb-4">Tasks</h2>
          <form onSubmit={createTask} className="grid sm:grid-cols-2 gap-3 max-w-2xl mb-6">
            <select className={input} value={taskForm.domain_id} onChange={(e) => setTaskForm((f) => ({ ...f, domain_id: e.target.value }))}>
              <option value="">All domains</option>
              {domains.filter((d) => !["lobby", "alumni"].includes(d.key)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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
              Due date — PKT (optional)
              <input className={input} type="datetime-local" value={taskForm.due_at} onChange={(e) => setTaskForm((f) => ({ ...f, due_at: e.target.value }))} />
            </label>
            <div className="flex items-end sm:col-span-1 justify-end">
              <button disabled={taskBusy} className="btn-neon font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
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
                    <button type="button" onClick={() => downloadFromR2(t.file_path)} className="text-xs panel border border-neutral-700 px-2 py-0.5 rounded text-blood hover:border-blood inline-flex items-center gap-1">
                      <span>📄</span>
                      <span className="max-w-[150px] truncate">{t.file_name || "PDF"}</span>
                    </button>
                  )}
                </div>
                <button onClick={() => deleteTask(t)} className="font-mono text-xs text-neutral-500 hover:text-blood shrink-0">delete</button>
              </div>
            ))}
          </div>
        </section>}

        {/* Workload dashboard — per-domain submission counts */}
        {activeTab === "review" && <section>
          <h2 className="font-mono text-xl text-white mb-4">Cohort Health</h2>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <div className="border border-blood/20 rounded-sm bg-ink-900/30 p-3"><div className="text-2xl text-white font-bold">{cohortHealth.activeStudents}</div><div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">active interns</div></div>
            <div className="border border-amber-500/30 rounded-sm bg-ink-900/30 p-3"><div className="text-2xl text-amber-400 font-bold">{cohortHealth.pending}</div><div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">pending review</div></div>
            <div className="border border-[#34d399]/30 rounded-sm bg-ink-900/30 p-3"><div className="text-2xl text-[#34d399] font-bold">{cohortHealth.approvalRate}%</div><div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">approval rate</div></div>
            <div className="border border-blood/20 rounded-sm bg-ink-900/30 p-3"><div className="text-2xl text-white font-bold">{cohortHealth.avgReviewHours ?? "-"}</div><div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">avg review hrs</div></div>
            <div className="border border-blood/40 rounded-sm bg-ink-900/30 p-3"><div className="text-2xl text-blood font-bold">{cohortHealth.atRisk.length}</div><div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">at risk</div></div>
          </div>
          {cohortHealth.atRisk.length > 0 && (
            <div className="border border-blood/20 rounded-sm overflow-hidden bg-ink-900/20">
              <div className="panel px-4 py-2 border-b border-blood/20 font-mono text-[11px] uppercase tracking-widest text-neutral-400">At-risk interns</div>
              <div className="divide-y divide-blood/10">
                {cohortHealth.atRisk.map((m) => (
                  <button key={m.id} type="button" onClick={() => openProfile(m.id)} className="w-full text-left px-4 py-3 hover:bg-ink-900/50 transition flex items-center justify-between gap-3">
                    <span className="font-mono text-sm text-white">{m.display_name || m.full_name || "Intern"} <span className="text-neutral-600">- {m.member_id || "no id"}</span></span>
                    <span className="font-mono text-[11px] text-neutral-400">overdue {m.overdueMissing} - rejected {m.rejectedCount} - approved {m.approvedCount}/{m.totalTasks}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>}

        {activeTab === "review" && <section>
          <h2 className="font-mono text-xl text-white mb-4">Workload</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {domains.filter((d) => !["lobby", "alumni"].includes(d.key)).map((d) => {
              const ds = subs.filter((s) => (s.profiles?.domain_id || s.tasks?.domain_id) === d.id);
              const pending = ds.filter((s) => s.status === "submitted").length;
              const approved = ds.filter((s) => s.status === "approved").length;
              const rejected = ds.filter((s) => s.status === "rejected").length;
              return (
                <div key={d.id} className="border border-blood/20 rounded-sm bg-ink-900/30 p-3">
                  <div className="font-mono text-xs uppercase tracking-widest text-blood truncate mb-2" title={d.name}>{d.name}</div>
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="text-amber-400" title="Pending review">{pending}⏳</span>
                    <span className="text-[#34d399]" title="Approved">{approved}✓</span>
                    <span className="text-blood" title="Rejected">{rejected}✗</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>}

        {/* Top contributors — global message leaderboard (admin-only) */}
        {activeTab === "review" && <section>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h2 className="font-mono text-xl text-white">Similarity Risk Scanner</h2>
            <span className={`font-mono text-[10px] uppercase tracking-widest border rounded-sm px-2.5 py-1 ${similarityFlags.length ? "border-amber-500/50 text-amber-400" : "border-[#34d399]/50 text-[#34d399]"}`}>
              {similarityFlags.length ? `${similarityFlags.length} flag${similarityFlags.length === 1 ? "" : "s"}` : "clear"}
            </span>
          </div>
          <p className="font-mono text-[11px] text-neutral-500 mb-3 max-w-2xl leading-relaxed">
            Heuristic scan of submitted filenames by task. It flags duplicate normalized names across interns and names too generic to audit. Full content similarity still needs server-side document text extraction.
          </p>
          {similarityFlags.length === 0 ? (
            <div className="border border-neutral-800 rounded-sm p-4 text-sm text-neutral-500">No filename-level similarity risks found.</div>
          ) : (
            <div className="space-y-2">
              {similarityFlags.map((flag, i) => (
                <div key={i} className="border border-amber-500/30 rounded-sm bg-amber-500/5 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`font-mono text-[10px] uppercase tracking-widest ${flag.severity === "high" ? "text-blood" : "text-amber-400"}`}>{flag.severity} risk</span>
                    <span className="font-mono text-[10px] text-neutral-600">{flag.rows.length} submission{flag.rows.length === 1 ? "" : "s"}</span>
                  </div>
                  <p className="font-mono text-xs text-neutral-400 mt-1">{flag.reason}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {flag.rows.map((s) => (
                      <span key={`${s.id}:${s.file_name}`} className="font-mono text-[11px] border border-neutral-800 rounded-sm px-2 py-1 text-neutral-300">
                        {s.profiles?.display_name || "Student"} - W{s.tasks?.week} - {s.file_name || "file"}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>}

        {activeTab === "review" && <section>
          <h2 className="font-mono text-xl text-white mb-4">Top contributors</h2>
          {leaderboard.length === 0 ? (
            <p className="font-mono text-xs text-neutral-500">No messages yet.</p>
          ) : (
            <div className="border border-blood/20 rounded-sm overflow-hidden bg-ink-900/20 overflow-x-auto">
              <table className="w-full text-sm font-mono">
                <thead className="bg-ink-900/60 text-neutral-500 uppercase text-xs tracking-widest border-b border-blood/10">
                  <tr>
                    <th className="text-left px-4 py-2.5">#</th>
                    <th className="text-left px-4 py-2.5">Member</th>
                    <th className="text-left px-4 py-2.5">Domain</th>
                    <th className="text-right px-4 py-2.5">Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, i) => (
                    <tr key={row.user_id} className="border-t border-blood/10 hover:bg-ink-900/40 transition">
                      <td className="px-4 py-2.5 text-neutral-500">{i + 1}</td>
                      <td className="px-4 py-2.5 text-white">{row.display_name || "—"}</td>
                      <td className="px-4 py-2.5 text-neutral-400">{domains.find((d) => d.id === row.domain_id)?.name || "—"}</td>
                      <td className="px-4 py-2.5 text-right text-blood font-bold">{row.cnt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>}

        {/* Extra-time requests — pending only */}
        {activeTab === "review" && extReqs.length > 0 && (
          <section>
            <h2 className="font-mono text-xl text-white mb-4">Extra-time requests ({extReqs.length})</h2>
            <div className="space-y-2">
              {extReqs.map((r) => (
                <div key={r.id} className="border border-blood/20 rounded-sm bg-ink-900/20 p-3 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 font-mono text-sm">
                    <span className="text-white">{r.profiles?.display_name || "Student"}</span>
                    <span className="text-neutral-500"> · W{r.tasks?.week} · {r.tasks?.title}</span>
                    <div className="text-[11px] text-neutral-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                      {r.profiles?.member_id && <span className="text-amber-400/90">{r.profiles.member_id}</span>}
                      <span>{domains.find((d) => d.id === r.profiles?.domain_id)?.name || "No department"}</span>
                      <span>· {r.profiles?.ram || "RAM —"}</span>
                    </div>
                    {r.reason && <div className="text-xs text-neutral-400 mt-1 break-words">“{r.reason}”</div>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => { setGrantUntil(defaultGrantUntil(r.task_id)); setGrantExt({ taskId: r.task_id, userId: r.user_id, name: r.profiles?.display_name || "Student", week: r.tasks?.week, taskTitle: r.tasks?.title }); }} className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">Grant</button>
                    <button onClick={() => decideExtension(r.id, false, 0)} className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1 rounded-sm hover:bg-blood hover:text-ink-950 transition">Deny</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Submission-change requests — founder-only. A student can't replace a pending/rejected
            submission until a founder approves here; approval unlocks exactly one re-upload. */}
        {activeTab === "review" && iAmFounder && changeReqs.length > 0 && (
          <section>
            <h2 className="font-mono text-xl text-white mb-1">Submission-change requests ({changeReqs.length})</h2>
            <p className="font-mono text-[11px] text-neutral-500 mb-4">Approving lets the student upload a new version once; it re-enters review as a fresh submission.</p>
            <div className="space-y-2">
              {changeReqs.map((r) => (
                <div key={r.id} className="border border-blood/20 rounded-sm bg-ink-900/20 p-3 flex items-center justify-between gap-4 flex-wrap">
                  <div className="min-w-0 font-mono text-sm">
                    <span className="text-white">{r.profiles?.display_name || "Student"}</span>
                    <span className="text-neutral-500"> · W{r.tasks?.week} · {r.tasks?.title}</span>
                    <div className="text-[11px] text-neutral-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                      {r.profiles?.member_id && <span className="text-amber-400/90">{r.profiles.member_id}</span>}
                      <span>{domains.find((d) => d.id === r.profiles?.domain_id)?.name || "No department"}</span>
                      <span>· {r.profiles?.ram || "RAM —"}</span>
                      <span>· {fmtLocalAndPKT(r.created_at)}</span>
                    </div>
                    {r.reason && <div className="text-xs text-neutral-400 mt-1 break-words">“{r.reason}”</div>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => decideChangeRequest(r.id, true)} className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">Approve</button>
                    <button onClick={() => decideChangeRequest(r.id, false)} className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1 rounded-sm hover:bg-blood hover:text-ink-950 transition">Deny</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {grantExt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setGrantExt(null)}>
            <div className="w-full max-w-sm border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm uppercase tracking-widest text-white">Grant extra time</h3>
                <button onClick={() => setGrantExt(null)} className="font-mono text-xs text-neutral-500 hover:text-blood">✕</button>
              </div>
              {grantExt.name && (
                <p className="font-mono text-[11px] text-neutral-400 break-words">
                  <span className="text-white">{grantExt.name}</span>
                  {grantExt.week != null && <span className="text-neutral-500"> · Week {grantExt.week}</span>}
                  {grantExt.taskTitle && <span className="text-neutral-500"> · {grantExt.taskTitle}</span>}
                </p>
              )}
              <label className="block font-mono text-[11px] text-neutral-500">Extension deadline — the date &amp; time this intern has until</label>
              <input type="datetime-local" value={grantUntil} onChange={(e) => setGrantUntil(e.target.value)} className={input + " w-full"} />
              <p className="font-mono text-[10px] text-neutral-600">Uses your local time. The intern can submit up to this moment.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setGrantExt(null)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition">Cancel</button>
                <button
                  onClick={() => grantExtensionUntil(grantExt.taskId, grantExt.userId, grantUntil)}
                  className="font-mono text-xs uppercase tracking-widest bg-[#34d399] text-ink-950 px-4 py-2 rounded-sm hover:opacity-90 transition">Grant</button>
              </div>
            </div>
          </div>
        )}

        {/* Weekly Task Report — founder-only. A single flat roster (one row per intern per task),
            not grouped by department: each intern's standing is approved, pending, rejected,
            extension requested, or no submission. */}
        {activeTab === "founder" && iAmFounder && (() => {
          const roster = reportRoster;
          const filtered = reportStatus ? roster.filter((p) => p.status === reportStatus) : roster;
          const counts = roster.reduce((acc, p) => { acc[p.status] = (acc[p.status] || 0) + 1; return acc; }, {});
          return (
            <section>
              <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
                <h2 className="font-mono text-xl text-white">
                  📊 Weekly Task Report <span className="text-neutral-500 text-sm">({filtered.length}{filtered.length !== roster.length ? ` / ${roster.length}` : ""})</span>
                </h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <select className={input} value={reportWeek} onChange={(e) => setReportWeek(e.target.value)}>
                    <option value="">All weeks</option>
                    {reportWeeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
                  </select>
                  <select className={input} value={reportDept} onChange={(e) => setReportDept(e.target.value)}>
                    <option value="">All departments</option>
                    {domains.filter((d) => !["lobby", "alumni"].includes(d.key)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                  <select className={input} value={reportStatus} onChange={(e) => setReportStatus(e.target.value)}>
                    <option value="">Any status</option>
                    {Object.entries(REPORT_STATUS_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
                  </select>
                  {(reportWeek || reportDept || reportStatus) && (
                    <button onClick={() => { setReportWeek(""); setReportDept(""); setReportStatus(""); }}
                      className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-400 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">Clear</button>
                  )}
                </div>
              </div>
              <p className="font-mono text-[11px] text-neutral-500 mb-3 max-w-2xl leading-relaxed">
                Every intern in one list — their standing on each task: approved, pending review, rejected,
                requested extra time, or no submission at all. Click a name for the full profile. An intern is
                counted for every task in their department and RAM tier (or an “All RAM” task) once they’re
                approved and non-alumni — regardless of when they joined.
              </p>
              <div className="flex items-center gap-2 flex-wrap mb-4 font-mono text-[10px] uppercase tracking-widest">
                {Object.entries(REPORT_STATUS_META).map(([k, m]) => (
                  <button key={k} type="button" onClick={() => setReportStatus(reportStatus === k ? "" : k)}
                    title={`Filter: ${m.label}`}
                    className={`inline-flex items-center gap-1.5 border rounded-sm px-2.5 py-1 transition ${reportStatus === k ? "border-blood bg-ink-900/60" : "border-neutral-800 hover:border-neutral-600"}`}>
                    <span>{m.emoji}</span>
                    <span className={m.tone}>{m.label}</span>
                    <span className={`font-bold ${m.tone}`}>{counts[k] || 0}</span>
                  </button>
                ))}
                <button type="button" onClick={downloadNoSubmissionCsv}
                  disabled={!counts.missing}
                  title="Download Full name, Email and phone (with country code) of everyone currently in the No-submission list"
                  className="ml-auto inline-flex items-center gap-1.5 border border-neutral-700 text-neutral-400 rounded-sm px-2.5 py-1 transition hover:border-neon-cyan hover:text-neon-cyan disabled:opacity-40 disabled:hover:border-neutral-700 disabled:hover:text-neutral-400 disabled:cursor-not-allowed">
                  <span>⬇</span>
                  <span>No-submission CSV</span>
                </button>
              </div>
              {roster.length === 0 ? (
                <p className="font-mono text-xs text-neutral-500 italic">No tasks match this filter yet.</p>
              ) : (
                <div className="overflow-x-auto border border-blood/20 rounded-sm max-h-[32rem] overflow-y-auto">
                  <table className="w-full text-xs font-mono whitespace-nowrap">
                    <thead className="panel text-neutral-500 uppercase tracking-widest sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2">Intern</th>
                        <th className="text-left px-3 py-2">Member ID</th>
                        <th className="text-left px-3 py-2">Dept</th>
                        <th className="text-left px-3 py-2">Week</th>
                        <th className="text-left px-3 py-2">Task</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-left px-3 py-2">Extension</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 ? (
                        <tr><td colSpan={7} className="px-3 py-6 text-center text-neutral-500 text-xs italic">No interns match this filter.</td></tr>
                      ) : filtered.map((p) => {
                        const meta = REPORT_STATUS_META[p.status] || REPORT_STATUS_META.missing;
                        return (
                          <tr key={`${p.task.id}:${p.id}`} className="border-t border-blood/10 hover:bg-ink-900/40 transition">
                            <td className="px-3 py-2">
                              <button type="button" onClick={() => openProfile(p.id)} title="View full profile"
                                className="text-left text-white hover:text-blood transition underline decoration-dotted decoration-neutral-600 underline-offset-2">
                                {p.name}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-neutral-400">{p.memberId || "—"}</td>
                            <td className="px-3 py-2 text-neutral-300">{domains.find((d) => d.id === p.deptId)?.name || "—"}</td>
                            <td className="px-3 py-2 text-neutral-400">Week {p.week}</td>
                            <td className="px-3 py-2 text-neutral-400 max-w-[220px] truncate" title={p.task.title}>{p.task.title}</td>
                            <td className="px-3 py-2">
                              <span className={meta.tone}>{meta.emoji} {meta.label}</span>
                              {p.status === "extension" && p.extStatus && p.extStatus !== "pending" && (
                                <span className="text-neutral-500 ml-1">· {p.extStatus === "approved" ? "granted" : "declined"}</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-col items-start gap-1">
                                <button type="button"
                                  onClick={() => { setGrantUntil(defaultGrantUntil(p.task.id, p.extendedUntil)); setGrantExt({ taskId: p.task.id, userId: p.id, name: p.name, week: p.week, taskTitle: p.task.title }); }}
                                  title="Grant this intern extra time on this task"
                                  className="font-mono text-[10px] uppercase tracking-widest border border-amber-500/50 text-amber-400 px-2.5 py-1 rounded-sm hover:bg-amber-500/10 hover:border-amber-400 transition">
                                  🕓 {p.extStatus === "approved" && p.extendedUntil ? "Change" : "Extend"}
                                </button>
                                {p.extStatus === "approved" && p.extendedUntil && (
                                  <span className="text-[10px] text-[#34d399] normal-case tracking-normal" title="This intern's deadline for this task is extended to here">
                                    until {fmtLocalAndPKT(p.extendedUntil)}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })()}

        {/* SLA review queue */}
        {activeTab === "review" && <section>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h2 className="font-mono text-xl text-white">Review Queue</h2>
            <span className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-400 rounded-sm px-2.5 py-1">oldest first</span>
          </div>
          {reviewQueue.length === 0 ? (
            <div className="border border-neutral-800 rounded-sm p-4 text-sm text-neutral-500">No pending submissions.</div>
          ) : (
            <div className="space-y-2">
              {reviewQueue.map((s) => (
                <div key={`queue:${s.id}`} className="border border-blood/20 rounded-sm bg-ink-900/25 p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-mono text-sm text-white">{s.profiles?.display_name || "Student"} <span className="text-neutral-600">- W{s.tasks?.week} - {s.tasks?.title}</span></div>
                    <div className="font-mono text-[11px] text-neutral-500 mt-0.5">
                      {domains.find((d) => d.id === (s.profiles?.domain_id || s.tasks?.domain_id))?.name || "No department"} - waiting {s.ageHours}h
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-mono text-[10px] uppercase tracking-widest border rounded-sm px-2 py-1 ${s.priority === "urgent" ? "border-blood text-blood" : s.priority === "high" ? "border-amber-500 text-amber-400" : "border-neutral-700 text-neutral-400"}`}>{s.priority}</span>
                    <button onClick={() => gradeSub(s, "approved")} className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">Approve</button>
                    <button onClick={() => gradeSub(s, "rejected")} className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1 rounded-sm hover:bg-blood hover:text-ink-950 transition">Reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>}

        {/* Submissions */}
        {activeTab === "review" && <section>
          <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
            <h2 className="font-mono text-xl text-white">Submissions ({filteredSubs.length}{filteredSubs.length !== subs.length ? ` / ${subs.length}` : ""})</h2>
            {selectedSubs.size > 0 && (
              <button onClick={bulkApprove} className="font-mono text-xs uppercase tracking-widest bg-[#34d399] text-ink-950 px-4 py-2 rounded-sm hover:opacity-90 transition">
                Approve selected ({selectedSubs.size})
              </button>
            )}
            <input className={input + " min-w-[160px]"} placeholder="Search student or task…" value={subSearch} onChange={(e) => setSubSearch(e.target.value)} />
            <select className={input} value={subStatus} onChange={(e) => setSubStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select
              className={input}
              value={subDomainFilter}
              onChange={(e) => setSubDomainFilter(e.target.value)}
            >
              <option value="">All Departments (Grouped)</option>
              {domains.filter((d) => !["lobby", "alumni"].includes(d.key)).map((d) => {
                const count = subs.filter((s) => (s.profiles?.domain_id || s.tasks?.domain_id) === d.id).length;
                return <option key={d.id} value={d.id}>{d.name} ({count})</option>;
              })}
            </select>
          </div>
          {iAmFounder && (
            <p className="font-mono text-[11px] text-neutral-500 mb-4 leading-relaxed">
              👑 Founder override: you can re-open a graded submission and flip its verdict — the
              opposite button (<span className="text-[#34d399]">→ Approve</span> /{" "}
              <span className="text-blood">→ Reject</span>) stays active on already-decided rows.
            </p>
          )}
          <div className="space-y-6">
            {domains
              .filter((d) => !["lobby", "alumni"].includes(d.key) && (!subDomainFilter || String(d.id) === String(subDomainFilter)))
              .map((d) => {
                const domainSubs = filteredSubs.filter((s) => (s.profiles?.domain_id || s.tasks?.domain_id) === d.id);
                return (
                  <div key={d.id} className="border border-blood/20 rounded-sm overflow-hidden bg-ink-900/20">
                    <div className="panel px-4 py-3 border-b border-blood/20 flex items-center justify-between">
                      <h3 className="font-mono text-sm uppercase tracking-widest text-blood font-bold flex items-center gap-2">
                        <span>▸ {d.name}</span>
                        <span className="text-neutral-500 font-normal">({domainSubs.length})</span>
                      </h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm font-mono">
                        <SubHead />
                        <tbody>
                          {domainSubs.length === 0 ? (
                            <tr><td colSpan={6} className="px-4 py-4 text-neutral-500 text-xs italic">No submissions for {d.name}.</td></tr>
                          ) : domainSubs.map((s) => (
                            <SubRow key={s.id} s={s} selected={selectedSubs.has(s.id)} onToggle={toggleSelect} onGrade={gradeSub} onDownload={downloadSub} onHistory={openHistory} onFeedbackReport={exportFeedbackReport} isFounder={iAmFounder} />
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
              const unassignedSubs = filteredSubs.filter((s) => !assignedIds.has(s.profiles?.domain_id) && !assignedIds.has(s.tasks?.domain_id));
              if (unassignedSubs.length === 0) return null;
              if (subDomainFilter) return null;
              return (
                <div className="border border-blood/20 rounded-sm overflow-hidden bg-ink-900/20">
                  <div className="panel px-4 py-3 border-b border-blood/20 flex items-center justify-between">
                    <h3 className="font-mono text-sm uppercase tracking-widest text-neutral-400 font-bold flex items-center gap-2">
                      <span>▸ General / Unassigned</span>
                      <span className="text-neutral-500 font-normal">({unassignedSubs.length})</span>
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm font-mono">
                      <SubHead />
                      <tbody>
                        {unassignedSubs.map((s) => (
                          <SubRow key={s.id} s={s} selected={selectedSubs.has(s.id)} onToggle={toggleSelect} onGrade={gradeSub} onDownload={downloadSub} onHistory={openHistory} onFeedbackReport={exportFeedbackReport} isFounder={iAmFounder} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        </section>}

        {/* Version-history dialog — all attempts for one submission */}
        {history && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setHistory(null)}>
            <div className="w-full max-w-md border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm uppercase tracking-widest text-white">Version history</h3>
                <button onClick={() => setHistory(null)} className="font-mono text-xs text-neutral-500 hover:text-blood">✕</button>
              </div>
              <p className="font-mono text-xs text-neutral-400">
                {history.sub.profiles?.display_name || "Student"} · W{history.sub.tasks?.week} · {history.sub.tasks?.title}
              </p>
              {history.files.length === 0 ? (
                <p className="font-mono text-xs text-neutral-500">No versioned attempts recorded (only submissions uploaded after this feature shipped are tracked).</p>
              ) : (
                <ul className="space-y-2 max-h-72 overflow-y-auto">
                  {history.files.map((f, i) => (
                    <li key={f.id} className="flex items-center justify-between gap-3 border border-blood/20 rounded-sm px-3 py-2">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-neutral-200 truncate">{f.file_name || "file"}</div>
                        <div className="font-mono text-[10px] text-neutral-500">
                          {i === 0 ? "latest · " : ""}{fmtLocalAndPKT(f.uploaded_at)}
                        </div>
                      </div>
                      <button onClick={() => downloadSub(f.file_path)} className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-blood hover:text-blood transition shrink-0">
                        Download
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Graduate + Best Intern prompt */}
        {gradModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setGradModal(null)}>
            <div className="w-full max-w-md border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm uppercase tracking-widest text-white">🎓 Graduate {gradModal.name}</h3>
                <button onClick={() => setGradModal(null)} className="font-mono text-xs text-neutral-500 hover:text-blood">✕</button>
              </div>
              <p className="text-xs text-neutral-400">They'll move to the Alumni Group (losing domain/lobby access) and see only their badges, documents, and certificate.</p>
              <label className="flex items-center gap-2 text-sm text-neutral-200 cursor-pointer border border-amber-500/40 bg-amber-500/5 rounded-sm px-3 py-2">
                <input type="checkbox" checked={gradModal.best} onChange={(e) => setGradModal((s) => ({ ...s, best: e.target.checked }))} className="accent-amber-500" />
                <span>🏆 Mark as <b>Best Intern</b> (top performer — max 3 per department)</span>
              </label>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setGradModal(null)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition">Cancel</button>
                <button onClick={confirmGraduate} disabled={gradBusy} className="font-mono text-xs uppercase tracking-widest bg-[#38bdf8] text-ink-950 px-4 py-2 rounded-sm hover:opacity-90 transition disabled:opacity-50 font-bold">{gradBusy ? "…" : "Graduate"}</button>
              </div>
            </div>
          </div>
        )}

        {/* Edit member profile (admin) — not email/password */}
        {editMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setEditMember(null)}>
            <div className="w-full max-w-md border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm uppercase tracking-widest text-white">Edit member profile</h3>
                <button onClick={() => setEditMember(null)} className="font-mono text-xs text-neutral-500 hover:text-blood">✕</button>
              </div>
              <p className="font-mono text-[11px] text-neutral-500">Email &amp; password can’t be changed here.</p>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">Display name</label>
                <input className={input + " w-full"} value={editMember.display_name} onChange={(e) => setEditMember((s) => ({ ...s, display_name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">Full name</label>
                <input className={input + " w-full"} value={editMember.full_name} onChange={(e) => setEditMember((s) => ({ ...s, full_name: e.target.value }))} placeholder="Optional" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">Gender</label>
                <select className={input + " w-full"} value={editMember.gender} onChange={(e) => setEditMember((s) => ({ ...s, gender: e.target.value }))}>
                  <option value="">Not set</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">Country</label>
                <select className={input + " w-full"} value={editMember.country} onChange={(e) => setEditMember((s) => ({ ...s, country: e.target.value }))}>
                  <option value="">Not set</option>
                  {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.dial})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">Member ID</label>
                <input className={input + " w-full font-mono tracking-wider"} value={editMember.member_id} onChange={(e) => setEditMember((s) => ({ ...s, member_id: e.target.value }))} placeholder="e.g. ZDR-2026-OS-001 (blank for admins)" />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditMember(null)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition">Cancel</button>
                <button onClick={saveMemberProfile} disabled={editBusy} className="font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">{editBusy ? "…" : "Save"}</button>
              </div>
            </div>
          </div>
        )}

        {/* Grade dialog — canned feedback picker + editable note */}
        {grading && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setGrading(null)}>
            <div className="w-full max-w-md border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-mono text-sm uppercase tracking-widest text-white">
                {grading.status === "approved" ? "Approve submission" : "Reject submission"}
              </h3>
              <p className="font-mono text-xs text-neutral-400">
                {grading.sub.profiles?.display_name || "Student"} · W{grading.sub.tasks?.week} · {grading.sub.tasks?.title}
              </p>
              {(grading.sub.status === "approved" || grading.sub.status === "rejected") && grading.sub.status !== grading.status && (
                <p className="font-mono text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-sm px-3 py-2">
                  ⚠️ Changing verdict: currently <b>{grading.sub.status}</b> → will become <b>{grading.status}</b>. The student will be re-notified.
                </p>
              )}
              <select className={input + " w-full"} value="" onChange={(e) => { if (e.target.value) setFbText(e.target.value); }}>
                <option value="">Insert canned feedback…</option>
                {(grading.status === "approved" ? CANNED_APPROVE : CANNED_REJECT).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <textarea
                className={input + " w-full h-28 resize-none"}
                placeholder={grading.status === "approved" ? "Optional feedback…" : "Reason for rejection…"}
                value={fbText}
                onChange={(e) => setFbText(e.target.value)}
              />
              {grading.status === "approved" && (() => {
                const keys = ["completeness", "accuracy", "evidence", "report"];
                const clamp = (v) => { const n = Number(v); return v === "" || !Number.isFinite(n) ? 0 : Math.max(0, Math.min(10, n)); };
                const overall = Math.round(keys.reduce((sum, k) => sum + clamp(scores[k]), 0) * 100) / 100;
                const anySet = keys.some((k) => scores[k] !== "");
                const pct = Math.round((overall / 40) * 100);
                const field = (key, label) => (
                  <label className="flex items-center justify-between gap-2 font-mono text-xs text-neutral-300">
                    <span>{label} <span className="text-neutral-600">/10</span></span>
                    <input type="number" min={0} max={10} step="0.5" value={scores[key]} placeholder="—"
                      onChange={(e) => setScores((s) => ({ ...s, [key]: e.target.value }))}
                      className={input + " w-20 text-right"} />
                  </label>
                );
                return (
                  <div className="border border-blood/20 rounded-sm p-3 space-y-2 bg-ink-900/40">
                    <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Marks (optional · each out of 10)</div>
                    {field("completeness", "Completeness")}
                    {field("accuracy", "Accuracy")}
                    {field("evidence", "Evidence")}
                    {field("report", "Report quality")}
                    <div className="flex items-center justify-between border-t border-blood/10 pt-2 font-mono text-xs">
                      <span className="text-neutral-400 uppercase tracking-widest">Overall</span>
                      <span className="font-bold text-white">
                        {anySet ? overall : "—"}<span className="text-neutral-600"> / 40</span>
                        {anySet && <span className="text-[#34d399] ml-2">{pct}%</span>}
                      </span>
                    </div>
                  </div>
                );
              })()}
              {err && <p className="font-mono text-xs text-blood bg-blood/10 border border-blood/30 rounded-sm px-3 py-2">{err}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setGrading(null)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition">Cancel</button>
                <button onClick={submitGrade} className={`font-mono text-xs uppercase tracking-widest px-4 py-2 rounded-sm transition ${grading.status === "approved" ? "bg-[#34d399] text-ink-950 hover:opacity-90" : "btn-neon hover:bg-blood-glow"}`}>
                  Confirm {grading.status === "approved" ? "approve" : "reject"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Founder-only: reset an intern's password (no current password needed) */}
        {resetPw && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setResetPw(null)}>
            <div className="w-full max-w-md border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm uppercase tracking-widest text-white">Reset password</h3>
                <button onClick={() => setResetPw(null)} className="font-mono text-xs text-neutral-500 hover:text-blood">✕</button>
              </div>
              <p className="font-mono text-[11px] text-neutral-500 leading-relaxed">
                Set a new password for <span className="text-neutral-200">{resetPw.name}</span>. They can sign in with it immediately and change it afterwards. Founder-only — their current password is not required.
              </p>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">New password</label>
                <PasswordInput className={`${input} w-full`} value={resetPwValue} onChange={(e) => setResetPwValue(e.target.value)} placeholder="Min 12 characters" autoComplete="new-password" />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-neutral-500 mb-1">Confirm password</label>
                <PasswordInput className={`${input} w-full`} value={resetPwConfirm} onChange={(e) => setResetPwConfirm(e.target.value)} placeholder="Re-enter" autoComplete="new-password" />
              </div>
              {resetPwErr && <p className="font-mono text-xs text-blood bg-blood/10 border border-blood/30 rounded-sm px-3 py-2">{resetPwErr}</p>}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setResetPw(null)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition">Cancel</button>
                <button onClick={submitResetPw} disabled={resetPwBusy} className="font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
                  {resetPwBusy ? "Resetting…" : "Reset password"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Signup details — everything an intern entered when they registered (review before approving) */}
        {viewMember && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setViewMember(null)}>
            <div className="w-full max-w-md border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-sm uppercase tracking-widest text-white flex items-center gap-2">
                  <span>Signup details</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-sm uppercase tracking-wider font-semibold ${viewMember.status === "pending" ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" : viewMember.status === "rejected" ? "bg-red-500/20 text-red-400 border border-red-500/30" : "bg-[#34d399]/20 text-[#34d399] border border-[#34d399]/30"}`}>
                    {viewMember.status || "approved"}
                  </span>
                </h3>
                <button onClick={() => setViewMember(null)} className="font-mono text-xs text-neutral-500 hover:text-blood">✕</button>
              </div>
              <p className="font-mono text-[11px] text-neutral-500 leading-relaxed">
                Everything this intern entered when they signed up.
              </p>
              {(() => {
                const dept = domains.find((d) => d.id === viewMember.domain_id)?.name || "—";
                const countryName = viewMember.country ? (COUNTRIES.find((c) => c.code === viewMember.country)?.name || viewMember.country) : null;
                const dial = viewMember.dial_code || (viewMember.country ? dialFor(viewMember.country) : "");
                const rows = [
                  ["Full name", viewMember.full_name || "—"],
                  ["Display name", viewMember.display_name || "—"],
                  ["Email", viewMember.email || "—"],
                  ["Department", dept],
                  ["RAM", viewMember.ram || "—"],
                  ["Country", countryName ? <span className="inline-flex items-center gap-1.5"><Flag code={viewMember.country} />{countryName}</span> : "—"],
                  ["Phone", viewMember.phone ? `${dial ? dial + " " : ""}${viewMember.phone}` : "—"],
                  ["Gender", viewMember.gender ? <span className="capitalize">{viewMember.gender}</span> : "—"],
                  ["Member ID", viewMember.member_id || "—"],
                  ["Discord", viewMember.discord_username || "—"],
                  ["Signed up", fmtLocalAndPKT(viewMember.created_at)],
                  ...(viewMember.role !== "admin" ? [
                    ["Login streak", (() => {
                      const s = streaks[viewMember.id];
                      return s
                        ? <span className="inline-flex items-center gap-2 flex-wrap justify-end"><StreakBadge s={s} /><span className="text-neutral-500">longest {s.longest_streak} · {s.total_days} days</span></span>
                        : "No logins recorded yet";
                    })()],
                    ["Last sign-in", fmtDT(streaks[viewMember.id]?.last_login)],
                    ["Last active", fmtDT(streaks[viewMember.id]?.last_active_at)],
                  ] : []),
                ];
                return (
                  <div className="border border-blood/20 rounded-sm divide-y divide-blood/10">
                    {rows.map(([label, val]) => (
                      <div key={label} className="flex items-start justify-between gap-4 px-3 py-2">
                        <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 pt-0.5 shrink-0">{label}</span>
                        <span className="font-mono text-xs text-neutral-100 text-right break-all">{val}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {viewMember.role !== "admin" && viewMember.status !== "approved" && (
                <div className="flex gap-2 justify-end pt-1">
                  <button
                    onClick={() => { setStatus(viewMember.id, "rejected"); setViewMember(null); }}
                    className="font-mono text-xs uppercase tracking-widest border border-red-500 text-red-400 px-4 py-2 rounded-sm hover:bg-red-500 hover:text-white transition"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => { setStatus(viewMember.id, "approved"); setViewMember(null); }}
                    className="font-mono text-xs uppercase tracking-widest bg-[#34d399] text-ink-950 px-4 py-2 rounded-sm hover:opacity-90 transition font-bold"
                  >
                    Accept
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Founder-only: consolidated user records (every signup field saved in the DB) */}
        {activeTab === "founder" && iAmFounder && (
          <section>
            <h2 className="font-mono text-xl text-white mb-1 flex items-center gap-3 flex-wrap">
              <span>👑 User Records <span className="text-neutral-500 text-sm">({filteredRecords.length}{filteredRecords.length !== userRecords.length ? ` / ${userRecords.length}` : ""})</span></span>
              <button onClick={loadUserRecords} className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-400 px-2.5 py-1 rounded-sm hover:border-neon-cyan hover:text-neon-cyan transition">↻ Refresh</button>
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#34d399]/80 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-pulse" />Live</span>
            </h2>
            <p className="font-mono text-[11px] text-neutral-500 mb-4 leading-relaxed">
              Founder-only. Every field saved at signup, loaded through a founder-checked RPC. Passwords are stored
              one-way hashed by Supabase Auth — only whether a hash exists is shown, never the password.
            </p>
            {userRecords.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap mb-4">
                <input className={input + " flex-1 min-w-[180px]"} placeholder="Search name, email, member ID, Discord…" value={urSearch} onChange={(e) => setUrSearch(e.target.value)} />
                <select className={input} value={urStatus} onChange={(e) => setUrStatus(e.target.value)}>
                  <option value="">Any status</option>
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                  <option value="rejected">Rejected</option>
                </select>
                <select className={input} value={urDept} onChange={(e) => setUrDept(e.target.value)}>
                  <option value="">All departments</option>
                  {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {(urSearch || urStatus || urDept) && (
                  <button onClick={() => { setUrSearch(""); setUrStatus(""); setUrDept(""); }}
                    className="font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-400 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">Clear</button>
                )}
              </div>
            )}
            {userRecords.length === 0 ? (
              <p className="font-mono text-xs text-neutral-600">No records yet — run migrations 039 and 059 in Supabase, then reload.</p>
            ) : (
              <div className="overflow-x-auto border border-blood/20 rounded-sm max-h-[32rem] overflow-y-auto">
                <table className="w-full text-xs font-mono whitespace-nowrap">
                  <thead className="panel text-neutral-500 uppercase tracking-widest sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2">Member ID</th>
                      <th className="text-left px-3 py-2">Full name</th>
                      <th className="text-left px-3 py-2">Display</th>
                      <th className="text-left px-3 py-2">Email</th>
                      <th className="text-left px-3 py-2">Gender</th>
                      <th className="text-left px-3 py-2">Dept</th>
                      <th className="text-left px-3 py-2">Country</th>
                      <th className="text-left px-3 py-2">Phone</th>
                      <th className="text-left px-3 py-2">RAM</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-left px-3 py-2">Discord</th>
                      <th className="text-left px-3 py-2">Password</th>
                      <th className="text-left px-3 py-2">Email&nbsp;✓</th>
                      <th className="text-left px-3 py-2">Last sign-in</th>
                      <th className="text-left px-3 py-2">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.length === 0 ? (
                      <tr><td colSpan={15} className="px-3 py-6 text-center text-neutral-500 text-xs italic">No records match your filters.</td></tr>
                    ) : filteredRecords.map((r) => (
                      <tr key={r.id} className="border-t border-blood/10 hover:bg-ink-900/40 transition">
                        <td className="px-3 py-2 text-neutral-300">{r.member_id || "—"}</td>
                        <td className="px-3 py-2 text-white">{r.full_name || "—"}</td>
                        <td className="px-3 py-2 text-neutral-300">{r.display_name || "—"}</td>
                        <td className="px-3 py-2 text-neutral-300">{r.email}</td>
                        <td className="px-3 py-2 text-neutral-400 capitalize">{r.gender || "—"}</td>
                        <td className="px-3 py-2 text-neutral-300">{domains.find((d) => d.id === r.domain_id)?.name || "—"}</td>
                        <td className="px-3 py-2 text-neutral-400">{r.country ? `${r.dial_code || ""} ${r.country}`.trim() : "—"}</td>
                        <td className="px-3 py-2 text-neutral-400">{r.phone || "—"}</td>
                        <td className="px-3 py-2 text-neutral-400">{r.ram || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={r.status === "approved" ? "text-[#34d399]" : r.status === "rejected" ? "text-blood" : "text-amber-400"}>{r.status}</span>
                          {r.is_alumni ? <span className="text-[#38bdf8] ml-1" title="Alumni">🎓</span> : null}
                          {r.is_founder ? <span className="text-amber-400 ml-1" title="Founder">👑</span> : null}
                        </td>
                        <td className="px-3 py-2 text-neutral-400">{r.discord_username || "—"}</td>
                        <td className="px-3 py-2">{r.has_password ? <span className="text-[#34d399]" title="Bcrypt hash stored">✓ hashed</span> : <span className="text-blood">✗ none</span>}</td>
                        <td className="px-3 py-2">{r.email_confirmed_at ? <span className="text-[#34d399]">✓</span> : <span className="text-neutral-600">—</span>}</td>
                        <td className="px-3 py-2 text-neutral-500">{r.last_sign_in_at ? new Date(r.last_sign_in_at).toLocaleDateString() : "—"}</td>
                        <td className="px-3 py-2 text-neutral-500">{r.auth_created_at ? new Date(r.auth_created_at).toLocaleDateString() : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Portal issues reported by users */}
        {activeTab === "moderation" && <section>
          <h2 className="font-mono text-xl text-white mb-4">
            Portal Issues {issues.filter((i) => i.status === "open").length > 0 && <span className="text-blood">({issues.filter((i) => i.status === "open").length} open)</span>}
          </h2>
          {issues.length === 0 ? (
            <p className="font-mono text-xs text-neutral-600">No issues reported.</p>
          ) : (
            <div className="space-y-2">
              {issues.map((it) => (
                <div key={it.id} className={`border rounded-sm p-4 ${it.status === "resolved" ? "border-neutral-800 opacity-60" : "border-neon-cyan/30"}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-neutral-500 break-words">
                        <span className="text-neon-cyan uppercase tracking-widest">{ISSUE_LABELS[it.category] || it.category}</span>
                        {" · "}<span className="text-neutral-300">{it.author_name || "Unknown"}</span>
                        {it.author_email ? <span className="text-neutral-500"> · {it.author_email}</span> : null}
                        {" · "}{new Date(it.created_at).toLocaleString()}
                      </div>
                      <p className="text-sm text-neutral-200 mt-1 break-words whitespace-pre-wrap">{it.body}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {it.status === "open" ? (
                        <button onClick={() => setIssueStatus(it.id, "resolved")} className="font-mono text-[11px] uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1.5 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">Mark resolved</button>
                      ) : (
                        <button onClick={() => setIssueStatus(it.id, "open")} className="font-mono text-[11px] uppercase tracking-widest border border-neutral-600 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-amber-400 hover:text-amber-400 transition">Reopen</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>}

        {/* Reported messages */}
        {activeTab === "moderation" && <section>
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
        </section>}

        {/* Audit log */}
        {activeTab === "moderation" && <section>
          <h2 className="font-mono text-xl text-white mb-4">Audit Log</h2>
          {audit.length === 0 ? (
            <p className="font-mono text-xs text-neutral-600">No admin actions logged yet.</p>
          ) : (
            <div className="overflow-x-auto border border-blood/20 rounded-sm max-h-80 overflow-y-auto">
              <table className="w-full text-sm font-mono">
                <thead className="panel text-neutral-500 uppercase text-xs tracking-widest sticky top-0">
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
        </section>}

        {/* Announcements */}
        {activeTab === "comms" && <section>
          <h2 className="font-mono text-xl text-white mb-4">Announcements</h2>
          <form onSubmit={postAnn} className="space-y-3 max-w-xl mb-6">
            <input className={`${input} w-full`} placeholder="Title" value={ann.title} onChange={(e) => setAnn((a) => ({ ...a, title: e.target.value }))} />
            <textarea className={`${input} w-full`} rows={3} placeholder="Body" value={ann.body} onChange={(e) => setAnn((a) => ({ ...a, body: e.target.value }))} />
            <input className={`${input} w-full`} placeholder="Link (optional) — https://…" value={ann.link} onChange={(e) => setAnn((a) => ({ ...a, link: e.target.value }))} />
            <div className="flex items-center gap-3 flex-wrap">
              <label className="cursor-pointer font-mono text-[11px] uppercase tracking-widest border border-blood/40 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
                <input type="file" className="hidden" onChange={(e) => setAnnFile(e.target.files?.[0] || null)} />
                📎 {annFile ? "Change file" : "Attach file"}
              </label>
              {annFile && (
                <span className="font-mono text-[11px] text-neutral-400 truncate max-w-[220px]">
                  {annFile.name}
                  <button type="button" onClick={() => setAnnFile(null)} className="text-blood ml-1.5" title="Remove attachment">✕</button>
                </span>
              )}
            </div>
            <label className="flex items-center gap-2 font-mono text-xs text-neutral-400 cursor-pointer select-none">
              <input type="checkbox" checked={annEmail} onChange={(e) => setAnnEmail(e.target.checked)} className="accent-blood" />
              Email all students about this announcement
            </label>
            <button disabled={annBusy} className="btn-neon font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
              {annBusy ? "Posting…" : "Post announcement"}
            </button>
          </form>
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-4 border border-blood/20 rounded-sm p-4">
                <div className="min-w-0">
                  <div className="font-mono text-white">{a.title}</div>
                  <div className="text-sm text-neutral-400">{a.body}</div>
                  {(a.link_url || a.attachment_key) && (
                    <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                      {a.link_url && <a href={a.link_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#38bdf8] hover:underline truncate max-w-[220px]">🔗 {a.link_url}</a>}
                      {a.attachment_key && <button onClick={() => downloadSub(a.attachment_key)} className="text-[11px] text-neutral-400 hover:text-blood">📎 {a.attachment_name || "attachment"}</button>}
                    </div>
                  )}
                </div>
                <button onClick={() => delAnn(a.id)} className="font-mono text-xs text-neutral-500 hover:text-blood shrink-0">delete</button>
              </div>
            ))}
          </div>
        </section>}

        {/* Live Sessions */}
        {activeTab === "comms" && <section>
          <h2 className="font-mono text-xl text-white mb-4">Live Sessions</h2>
          <form onSubmit={createSession} className="space-y-3 max-w-xl mb-6">
            <input className={`${input} w-full`} placeholder="Session title" value={sessionForm.title} onChange={(e) => setSessionForm((s) => ({ ...s, title: e.target.value }))} />
            <textarea className={`${input} w-full`} rows={2} placeholder="Description (optional)" value={sessionForm.description} onChange={(e) => setSessionForm((s) => ({ ...s, description: e.target.value }))} />
            <div className="flex flex-col sm:flex-row gap-3">
              <label className="font-mono text-xs text-neutral-500 flex flex-col gap-1 flex-1">
                Starts — PKT
                <input type="datetime-local" className={input} value={sessionForm.starts_at} onChange={(e) => setSessionForm((s) => ({ ...s, starts_at: e.target.value }))} />
              </label>
              <select className={`${input} flex-1`} value={sessionForm.domain_id} onChange={(e) => setSessionForm((s) => ({ ...s, domain_id: e.target.value }))}>
                <option value="">All departments</option>
                {domains.filter((d) => !["lobby", "alumni"].includes(d.key)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <input className={`${input} w-full`} placeholder="Join URL (Zoom / Meet / Discord — optional)" value={sessionForm.join_url} onChange={(e) => setSessionForm((s) => ({ ...s, join_url: e.target.value }))} />
            <button className="btn-neon font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition">
              Schedule session
            </button>
          </form>
          <div className="space-y-3">
            {sessions.length === 0 && <p className="font-mono text-xs text-neutral-500">No sessions scheduled.</p>}
            {sessions.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-4 border border-blood/20 rounded-sm p-4">
                <div className="min-w-0">
                  <div className="font-mono text-white">{s.title}</div>
                  <div className="text-xs text-neutral-500">{fmtLocalAndPKT(s.starts_at)} · {s.domain_id ? (domains.find((d) => d.id === s.domain_id)?.name || "Dept") : "All departments"}</div>
                  <div className="text-[11px] text-neutral-500 mt-1">
                    RSVP {sessionAttendance.filter((a) => a.session_id === s.id && a.status === "going").length} - Attended {sessionAttendance.filter((a) => a.session_id === s.id && a.status === "attended").length}
                  </div>
                  {s.description && <div className="text-sm text-neutral-400 mt-1">{s.description}</div>}
                  {s.join_url && <a href={s.join_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#38bdf8] hover:underline break-all">{s.join_url}</a>}
                </div>
                <button onClick={() => deleteSession(s.id)} className="font-mono text-xs text-neutral-500 hover:text-blood shrink-0">delete</button>
              </div>
            ))}
          </div>
        </section>}

        {/* Testimonials / Feedback */}
        {activeTab === "comms" && <section>
          <h2 className="font-mono text-xl text-white mb-4">Testimonials &amp; Feedback</h2>
          <div className="space-y-3">
            {feedbacks.length === 0 && <p className="font-mono text-xs text-neutral-500">No feedback submitted yet.</p>}
            {feedbacks.map((f) => (
              <div key={f.id} className="border border-blood/20 rounded-sm p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-sm text-white">{f.profiles?.display_name || "Intern"}</div>
                  <span className={`font-mono text-[11px] uppercase tracking-widest ${f.status === "approved" ? "text-[#34d399]" : f.status === "rejected" ? "text-blood" : "text-amber-400"}`}>{f.status}</span>
                </div>
                <div className="text-xs text-neutral-500">Program: <span className="text-amber-400">{"★".repeat(f.rating_program)}</span> · Portal: <span className="text-amber-400">{"★".repeat(f.rating_portal)}</span></div>
                <p className="text-sm text-neutral-300">“{f.body}”</p>
                <div className="flex gap-2 pt-1">
                  {f.status !== "approved" && <button onClick={() => setFeedbackStatus(f.id, "approved")} className="font-mono text-[11px] uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1.5 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">Approve</button>}
                  {f.status !== "rejected" && <button onClick={() => setFeedbackStatus(f.id, "rejected")} className="font-mono text-[11px] uppercase tracking-widest border border-blood text-blood px-3 py-1.5 rounded-sm hover:bg-blood hover:text-ink-950 transition">Reject</button>}
                </div>
              </div>
            ))}
          </div>
        </section>}
      </div>
    </div>
  );
}
