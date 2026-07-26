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
