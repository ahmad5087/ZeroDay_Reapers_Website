import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendPushToUser, pushConfigured } from "@/lib/push";

export const runtime = "nodejs";

// Send a test push to the caller's own devices (used by the "Send test" button in Profile).
export async function POST(req) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!pushConfigured()) {
    return NextResponse.json({ error: "Push not configured (VAPID keys missing on the server)" }, { status: 503 });
  }

  const { sent, failed } = await sendPushToUser(user.id, {
    title: "ZeroDay Reapers",
    body: "Push notifications are working ✅",
    url: "/portal",
    tag: "zdr-test",
  });
  return NextResponse.json({ ok: true, sent, failed });
}
