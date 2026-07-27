import { supabase } from "@/lib/supabase";

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" };
}

// Upload a file to R2 via a presigned PUT. Returns { key, name }.
// kind: "task" (needs taskId) | "resume" | "other"
export async function uploadToR2(file, { kind, taskId } = {}) {
  const headers = await authHeader();
  const res = await fetch("/api/r2/upload-url", {
    method: "POST",
    headers,
    body: JSON.stringify({ kind, taskId, fileName: file.name, contentType: file.type, size: file.size }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not get upload URL");
  const { url, key } = await res.json();

  const put = await fetch(url, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!put.ok) throw new Error("Upload to storage failed");
  return { key, name: file.name };
}

export async function downloadFromR2(key) {
  const headers = await authHeader();
  const res = await fetch("/api/r2/download-url", { method: "POST", headers, body: JSON.stringify({ key }) });
  if (!res.ok) throw new Error("Could not get download URL");
  const { url } = await res.json();
  window.open(url, "_blank");
}

export async function deleteFromR2(key) {
  const headers = await authHeader();
  await fetch("/api/r2/delete", { method: "POST", headers, body: JSON.stringify({ key }) });
}
