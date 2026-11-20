// Cohort number parsed from the member_id label, e.g. "ZDR-2026-Cohort1-OS-001" → "1".
// Pre-105 IDs were hardcoded Cohort1, so Cohort-1 members parse correctly. Returns null when the
// ID has no cohort segment (a member without an assigned ID yet, or a non-student account).
export function cohortOf(member) {
  const m = /cohort\s*(\d+)/i.exec(member?.member_id || "");
  return m ? m[1] : null;
}

// A cohort's start (app_settings.cohort_starts, migration 115) is a plain "YYYY-MM-DD". The cohort begins
// at 00:01 AM Pakistan time (PKT = UTC+5, no DST) on that day — Week 1 unlocks then. Parse a bare date at
// that PKT instant, not UTC midnight (which read as 05:00 AM PKT); a value that already carries a time is
// used as-is. Returns epoch ms, or NaN when unset/invalid.
export function cohortStartMs(start) {
  if (!start) return NaN;
  const s = /^\d{4}-\d{2}-\d{2}$/.test(start) ? `${start}T00:01:00+05:00` : start;
  return new Date(s).getTime();
}
