import { supabase } from "@/lib/supabase";

// Admin → student email via /api/notify. Best-effort; returns true when the send succeeded so callers
// that fan out (e.g. the founder's "email at-risk interns" action) can report how many went through.
export async function notifyUser(userId, subject, html) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId, subject, html }),
    });
    return res.ok;
  } catch {
    /* email is best-effort — ignore failures */
    return false;
  }
}

// Admin → many students. audience: { domainId?: number|null, ram?: string|null } (null = everyone).
// Best-effort; no-ops server-side until Resend is configured.
export async function broadcastEmail(audience, subject, html) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch("/api/email/broadcast", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ audience, subject, html }),
    });
  } catch {
    /* best-effort */
  }
}

// Student → their own address only (e.g. a submission receipt). Best-effort.
export async function emailSelf(subject, html) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch("/api/email/self", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ subject, html }),
    });
  } catch {
    /* best-effort */
  }
}
