import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUser } from "@/lib/push";
import { emailConfigured, sendEmail } from "@/lib/email";

export const runtime = "nodejs";

async function getAdmin(req) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return null;
  const { data: prof } = await sb.from("profiles").select("role").eq("id", user.id).single();
  if (prof?.role !== "admin") return null;
  return { sb };
}

export async function POST(req) {
  if (!emailConfigured()) return NextResponse.json({ error: "Email not configured" }, { status: 503 });
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, subject, html } = await req.json().catch(() => ({}));
  if (!userId || !subject || !html) return NextResponse.json({ error: "userId, subject, html required" }, { status: 400 });

  // Admin can read the recipient's email (RLS allows is_admin).
  const { data: prof } = await admin.sb.from("profiles").select("email").eq("id", userId).single();
  if (!prof?.email) return NextResponse.json({ error: "No email for user" }, { status: 404 });

  const emailResult = await sendEmail(prof.email, subject, html);
  if (!emailResult.ok) {
    return NextResponse.json({
      error: emailResult.rateLimited ? "Email provider rate limit persisted after retries" : "Send failed",
    }, { status: 502 });
  }

  // Best-effort Web Push alongside the email (no-op if VAPID unset or the user has no subscriptions).
  sendPushToUser(userId, {
    title: subject,
    body: String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180),
    url: "/portal",
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
