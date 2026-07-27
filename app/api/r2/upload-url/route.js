import { NextResponse } from "next/server";
import { presignPut, getAuthedUser, r2Configured, UPLOAD_LIMITS, rateLimit } from "@/lib/r2";

export const runtime = "nodejs";

const safe = (s = "file") => s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
const ext = (name = "") => (name.includes(".") ? name.split(".").pop().toLowerCase() : "bin");

export async function POST(req) {
  if (!r2Configured) return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit("r2-upload:" + user.id, { limit: 20, windowMs: 60_000 }))
    return NextResponse.json({ error: "Too many uploads — slow down and try again shortly." }, { status: 429 });

  const { kind, taskId, week, fileName, contentType, size } = await req.json().catch(() => ({}));
  if (!fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });

  // Enforce per-kind file-type + size constraints.
  const limits = UPLOAD_LIMITS[kind] || UPLOAD_LIMITS.other;
  const e = ext(fileName);
  if (!limits.exts.includes(e))
    return NextResponse.json({ error: `File type .${e} not allowed. Allowed: ${limits.exts.join(", ")}.` }, { status: 415 });
  if (typeof size === "number" && size > limits.maxBytes)
    return NextResponse.json({ error: `File too large (max ${Math.round(limits.maxBytes / 1024 / 1024)}MB).` }, { status: 413 });

  let key;
  if (kind === "task-pdf") {
    if (user.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
    key = `tasks/week-${week || "0"}-${Date.now()}-${safe(fileName)}`;
  } else if (kind === "task") {
    if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
    // Timestamped key so each attempt is versioned (no overwrite). Stays under
    // submissions/{uid}/ so ownsKey() access checks are unchanged.
    key = `submissions/${user.id}/task-${taskId}-${Date.now()}.${e}`;
  } else if (kind === "payment") {
    // Private payment proof (financial PII) — under {uid}/ so ownsKey restricts to owner + admin.
    key = `payment/${user.id}/proof-${Date.now()}.${e}`;
  } else if (kind === "resume") {
    key = `documents/${user.id}/resume.${e}`;
  } else {
    key = `documents/${user.id}/${Date.now()}-${safe(fileName)}`;
  }

  // Bind ContentType into the signature so the client must PUT with the declared type.
  const url = await presignPut(key, contentType || "application/octet-stream");
  return NextResponse.json({ url, key });
}
