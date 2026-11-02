// Cohort number parsed from the member_id label, e.g. "ZDR-2026-Cohort1-OS-001" → "1".
// Pre-105 IDs were hardcoded Cohort1, so Cohort-1 members parse correctly. Returns null when the
// ID has no cohort segment (a member without an assigned ID yet, or a non-student account).
export function cohortOf(member) {
  const m = /cohort\s*(\d+)/i.exec(member?.member_id || "");
  return m ? m[1] : null;
}
