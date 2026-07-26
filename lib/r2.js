import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";

// Server-only R2 client (S3-compatible). Secrets never reach the browser.
export const R2_BUCKET = process.env.R2_BUCKET;
export const r2Configured = Boolean(
  process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && R2_BUCKET
);

const r2 = r2Configured
  ? new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    })
  : null;

export function presignPut(key, contentType) {
  return getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }), { expiresIn: 300 });
}
export function presignGet(key) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 300 });
}
export function deleteObject(key) {
  return r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

// Verify the caller's Supabase session (JWT in Authorization header) → {id, role}.
export async function getAuthedUser(req) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return null;
  const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
  return { id: user.id, role: prof?.role || "student" };
}

// Keys look like "submissions/{uid}/..." or "documents/{uid}/..." — the uid is segment 1.
export function ownsKey(user, key) {
  if (!key || typeof key !== "string") return false;
  if (user.role === "admin") return true;
  return key.split("/")[1] === user.id;
}
