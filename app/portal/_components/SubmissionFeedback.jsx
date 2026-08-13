"use client";

import { fmtLocalAndPKT } from "../_lib";

export function formatMark(value) {
  return value == null ? "—" : String(Number(value));
}

export function feedbackStatusMeta(status) {
  if (status === "approved") return { label: "Approved", tone: "border-[#34d399]/40 bg-[#34d399]/5 text-[#34d399]" };
  if (status === "rejected") return { label: "Needs changes", tone: "border-blood/40 bg-blood/5 text-blood" };
  return { label: "Awaiting review", tone: "border-amber-500/40 bg-amber-500/5 text-amber-400" };
}

// Overlay the current `submissions` pointer onto version rows. This keeps the UI useful before migration
// 068 is applied and prevents duplicate display once the snapshot columns are live.
export function mergeSubmissionAttempts(files = [], current = []) {
  const merged = files.map((row) => ({ ...row }));
  for (const sub of current) {
    const index = merged.findIndex((row) =>
      String(row.task_id) === String(sub.task_id) && row.file_path && row.file_path === sub.file_path);
    const normalized = {
      ...sub,
      uploaded_at: sub.uploaded_at || sub.submitted_at,
      tasks: sub.tasks || null,
      _current: true,
    };
    if (index >= 0) merged[index] = { ...merged[index], ...normalized, tasks: merged[index].tasks || normalized.tasks };
    else merged.push(normalized);
  }
  return merged.sort((a, b) => new Date(b.uploaded_at || b.submitted_at || 0) - new Date(a.uploaded_at || a.submitted_at || 0));
}

export function groupAttemptsByWeek(attempts = []) {
  const groups = new Map();
  for (const attempt of attempts) {
    const week = Number(attempt.tasks?.week);
    const key = Number.isFinite(week) ? week : "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(attempt);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a === "other" ? 1 : b === "other" ? -1 : Number(a) - Number(b))
    .map(([week, items]) => ({ week, items }));
}

export function attemptLabelFor(attempt, weekItems = []) {
  const sameTask = weekItems.filter((item) => String(item.task_id) === String(attempt.task_id));
  const index = sameTask.indexOf(attempt);
  return `Attempt ${Math.max(1, sameTask.length - Math.max(index, 0))}`;
}

export function SubmissionFeedbackCard({ attempt, task, attemptLabel, showTask = true }) {
  const meta = feedbackStatusMeta(attempt?.status);
  const hasMarks = [
    attempt?.score_completeness,
    attempt?.score_accuracy,
    attempt?.score_evidence,
    attempt?.score_report,
  ].some((value) => value != null);
  const total = attempt?.score_overall != null
    ? Number(attempt.score_overall)
    : hasMarks
      ? [attempt.score_completeness, attempt.score_accuracy, attempt.score_evidence, attempt.score_report]
          .reduce((sum, value) => sum + Number(value || 0), 0)
      : null;

  return (
    <article className={`border rounded-sm p-4 ${meta.tone}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {showTask && (
            <h4 className="font-mono text-sm text-white">
              Week {task?.week ?? "—"}{task?.title ? ` · ${task.title}` : ""}
            </h4>
          )}
          <p className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 mt-1">
            {attemptLabel ? `${attemptLabel} · ` : ""}
            {attempt?.uploaded_at || attempt?.submitted_at
              ? fmtLocalAndPKT(attempt.uploaded_at || attempt.submitted_at)
              : "Date unavailable"}
          </p>
        </div>
        <span className={`font-mono text-[10px] uppercase tracking-widest border rounded-sm px-2 py-1 ${meta.tone}`}>
          {meta.label}
        </span>
      </div>

      {hasMarks && (
        <div className="mt-4 border border-white/10 rounded-sm bg-black/20 p-3">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 mb-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Marks</span>
            <span className="font-mono text-sm font-bold text-white">
              {formatMark(total)}<span className="text-neutral-600"> / 40</span>
              <span className="text-[#34d399] ml-2">{Math.round((Number(total) / 40) * 100)}%</span>
            </span>
          </div>
          <div className="grid sm:grid-cols-2 gap-x-5 gap-y-1.5 font-mono text-xs text-neutral-400">
            <span className="flex justify-between gap-3"><span>Completeness</span><span className="text-neutral-100">{formatMark(attempt.score_completeness)}/10</span></span>
            <span className="flex justify-between gap-3"><span>Accuracy</span><span className="text-neutral-100">{formatMark(attempt.score_accuracy)}/10</span></span>
            <span className="flex justify-between gap-3"><span>Evidence</span><span className="text-neutral-100">{formatMark(attempt.score_evidence)}/10</span></span>
            <span className="flex justify-between gap-3"><span>Report quality</span><span className="text-neutral-100">{formatMark(attempt.score_report)}/10</span></span>
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Mentor feedback</div>
        <p className={`mt-1 text-sm whitespace-pre-wrap leading-relaxed ${attempt?.feedback ? "text-neutral-200" : "text-neutral-600 italic"}`}>
          {attempt?.feedback || (attempt?.graded_at ? "No written feedback was provided for this attempt." : "This attempt has not been graded yet.")}
        </p>
      </div>
    </article>
  );
}
