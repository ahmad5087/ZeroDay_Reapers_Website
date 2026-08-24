// Structured server logging (Phase 15 — observability). One-line JSON to stdout/stderr, captured by
// Vercel's log drain and searchable by `evt`. Falls back to plain logging if serialization fails.
export function logError(evt, err, meta = {}) {
  try {
    console.error(JSON.stringify({ level: "error", evt, msg: err?.message || String(err), ...meta, ts: new Date().toISOString() }));
  } catch {
    console.error(`[${evt}]`, err);
  }
}

export function logInfo(evt, meta = {}) {
  try {
    console.log(JSON.stringify({ level: "info", evt, ...meta, ts: new Date().toISOString() }));
  } catch {
    console.log(`[${evt}]`);
  }
}
