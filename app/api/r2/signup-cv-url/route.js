import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { presignPut, r2Configured, UPLOAD_LIMITS, rateLimit } from "@/lib/r2";

export const runtime = "nodejs";

// Public (pre-auth) presign for the CV a new applicant attaches on the Sign-up screen. Unlike
// /api/r2/upload-url this has NO session (the account doesn't exist yet / isn't logged in), so it is
// deliberately locked down: PDF only, size-capped, IP rate-limited, and the object lands under a
// random `signup/<uuid>.pdf` key that only admins can later read (lib/r2.js ownsKey). The returned key
// is carried into supabase.auth.signUp metadata → handle_new_user writes it to profiles.cv_key.
const MAX_BYTES = UPLOAD_LIMITS.resume.maxBytes; // 15MB, same cap as the authed resume uploader

function clientIp(req) {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req) {
  if (!r2Configured) return NextResponse.json({ error: "Storage not configured" }, { status: 503 });

  // Best-effort per-IP throttle (warm-instance scoped, like the authed uploader).
  if (!rateLimit("signup-cv:" + clientIp(req), { limit: 10, windowMs: 60_000 }))
    return NextResponse.json({ error: "Too many uploads — please wait a moment and try again." }, { status: 429 });

  const { fileName, contentType, size } = await req.json().catch(() => ({}));
  if (!fileName) return NextResponse.json({ error: "fileName required" }, { status: 400 });

  // PDF only — check both the extension and the declared content type.
  const isPdf =
    /\.pdf$/i.test(String(fileName)) &&
    (!contentType || /^application\/pdf$/i.test(String(contentType)));
  if (!isPdf) return NextResponse.json({ error: "Only PDF files are accepted for your CV." }, { status: 415 });
  if (typeof size === "number" && size > MAX_BYTES)
    return NextResponse.json({ error: `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)}MB).` }, { status: 413 });

  const key = `signup/${randomUUID()}.pdf`;
  // Force application/pdf into the signature so the client PUT must send a PDF content type.
  const url = await presignPut(key, "application/pdf");
  return NextResponse.json({ url, key });
}
