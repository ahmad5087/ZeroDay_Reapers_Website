import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendBulk, emailConfigured } from "@/lib/email";

export const runtime = "nodejs";

// Admin-only fan-out email: task-assigned (domain+RAM audience) and manual announcements (all).
// Recipients are resolved server-side under the admin's own RLS (admins may read profile emails).
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
  const admin = await getAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { audience = {}, subject, html } = await req.json().catch(() => ({}));
  if (!subject || !html) return NextResponse.json({ error: "subject, html required" }, { status: 400 });

  // Nothing to do until Resend is configured — skip the recipient query entirely.
  if (!emailConfigured()) return NextResponse.json({ ok: true, skipped: true });

  // Approved, non-alumni students, filtered by the audience (null domain/ram = everyone).
  let q = admin.sb.from("profiles").select("email")
    .eq("status", "approved").eq("is_alumni", false).eq("role", "student");
  if (audience.domainId != null) q = q.eq("domain_id", audience.domainId);
  if (audience.ram != null) q = q.eq("ram", audience.ram);

  const { data, error } = await q.limit(2000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const emails = (data || []).map((r) => r.email).filter(Boolean);
  const result = await sendBulk(emails, subject, html);
  return NextResponse.json({ ok: true, ...result });
}
