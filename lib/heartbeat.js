// Cron dead-man's switch (Phase 15 — reliability). POSTs a success ping to a healthchecks.io URL (or a
// gatus push endpoint) taken from an env var; a *missed* ping then alerts you, not just an errored run.
// No-op when the env var is unset, and never throws — a failed heartbeat must never fail the cron.
export async function heartbeat(envKey) {
  const url = process.env[envKey];
  if (!url) return;
  try {
    await fetch(url, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(5000) });
  } catch {
    /* best-effort — the point of the heartbeat is that a MISSED one alarms; a failed POST is harmless */
  }
}
