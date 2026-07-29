import { supabase } from "@/lib/supabase";

// Fire-and-forget admin → student email via /api/notify. Never blocks the UI action.
export async function notifyUser(userId, subject, html) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    await fetch("/api/notify", {
      method: "POST",
      headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId, subject, html }),
    });
  } catch {
    /* email is best-effort — ignore failures */
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
