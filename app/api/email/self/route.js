import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";

export const runtime = "nodejs";

// Lets an authenticated user email ONLY their own address (e.g. a submission receipt).
// The recipient is taken from the verified token, never from the request body — so a student
// can never use this to email anyone else.
export async function POST(req) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { subject, html } = await req.json().catch(() => ({}));
  if (!subject || !html) return NextResponse.json({ error: "subject, html required" }, { status: 400 });

  await sendEmail(user.email, subject, html);
  return NextResponse.json({ ok: true });
}
