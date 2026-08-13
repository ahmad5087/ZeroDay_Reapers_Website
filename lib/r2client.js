import { supabase } from "@/lib/supabase";

async function authHeader() {
  const { data: { session } } = await supabase.auth.getSession();
  return { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" };
}

// Upload a file to R2 via a presigned PUT. Returns { key, name }.
// kind: "task" (needs taskId) | "resume" | "other" | "certificate" (admin: needs targetUid + certType)
export async function uploadToR2(file, { kind, taskId, targetUid, certType } = {}) {
  const headers = await authHeader();
  const res = await fetch("/api/r2/upload-url", {
    method: "POST",
    headers,
    body: JSON.stringify({ kind, taskId, targetUid, certType, fileName: file.name, contentType: file.type, size: file.size }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Could not get upload URL");
  const { url, key } = await res.json();

  const put = await fetch(url, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
  if (!put.ok) throw new Error("Upload to storage failed");
  return { key, name: file.name };
}

// filename (optional): name the file exactly this via a signed Content-Disposition on the presigned
// URL (the cross-origin <a download> attribute is ignored, so this is the only way to set the name).
// inline:true → open the PDF in a new tab to preview; saving it uses the name (preview-then-download).
// inline:false with a filename → download immediately. No filename → open inline, unnamed.
export async function downloadFromR2(key, filename, { inline = false } = {}) {
  const headers = await authHeader();
  const res = await fetch("/api/r2/download-url", {
    method: "POST",
    headers,
    body: JSON.stringify(filename ? { key, filename, inline } : { key }),
  });
  if (!res.ok) throw new Error("Could not get download URL");
  const { url } = await res.json();
  if (filename && !inline) {
    // Attachment response → click a transient anchor so it downloads without leaving a blank tab.
    const a = document.createElement("a");
    a.href = url;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    // inline (preview, named on save) or no filename → open in a new tab.
    window.open(url, "_blank");
  }
}

export async function deleteFromR2(key) {
  const headers = await authHeader();
  await fetch("/api/r2/delete", { method: "POST", headers, body: JSON.stringify({ key }) });
}
