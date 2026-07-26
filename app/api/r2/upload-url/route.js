import { NextResponse } from "next/server";
import { presignPut, getAuthedUser, r2Configured } from "@/lib/r2";

export const runtime = "nodejs";

const safe = (s = "file") => s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
const ext = (name = "") => (name.includes(".") ? name.split(".").pop().toLowerCase() : "bin");

export async function POST(req) {
  if (!r2Configured) return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { kind, taskId, week, fileName, contentType } = await req.json().catch(() => ({}));
  if (!fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });

  let key;
  if (kind === "task-pdf") {
    if (user.role !== "admin") return NextResponse.json({ error: "Admin required" }, { status: 403 });
    key = `tasks/week-${week || "0"}-${Date.now()}-${safe(fileName)}`;
  } else if (kind === "task") {
    if (!taskId) return NextResponse.json({ error: "taskId required" }, { status: 400 });
    key = `submissions/${user.id}/task-${taskId}.${ext(fileName)}`;
  } else if (kind === "resume") {
    key = `documents/${user.id}/resume.${ext(fileName)}`;
  } else {
    key = `documents/${user.id}/${Date.now()}-${safe(fileName)}`;
  }

  const url = await presignPut(key, contentType || "application/octet-stream");
  return NextResponse.json({ url, key });
}
