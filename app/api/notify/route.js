import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || "ZeroDay Reapers <onboarding@resend.dev>";

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
  if (!RESEND_API_KEY) return NextResponse.json({ error: "Email not configured" }, { status: 503 });
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { userId, subject, html } = await req.json().catch(() => ({}));
  if (!userId || !subject || !html) return NextResponse.json({ error: "userId, subject, html required" }, { status: 400 });

  // Admin can read the recipient's email (RLS allows is_admin).
  const { data: prof } = await admin.sb.from("profiles").select("email").eq("id", userId).single();
  if (!prof?.email) return NextResponse.json({ error: "No email for user" }, { status: 404 });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: prof.email, subject, html }),
  });
  if (!res.ok) return NextResponse.json({ error: "Send failed: " + (await res.text()) }, { status: 502 });
  return NextResponse.json({ ok: true });
}
