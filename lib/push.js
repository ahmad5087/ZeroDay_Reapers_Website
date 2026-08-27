// Web Push (Phase 17) — server-side sender using the Web Push Protocol (VAPID) via `web-push`.
// Fully gated on the VAPID env vars: with keys unset, pushConfigured() is false and every send is a
// no-op, so the app is completely unaffected until you generate + set keys. To rotate the signer later,
// just change the env vars — no code change.
import webpush from "web-push";
import { createClient } from "@supabase/supabase-js";

const PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const PRIVATE = process.env.VAPID_PRIVATE_KEY;
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:contact@zerodayreapers.me";

let configured = false;
if (PUBLIC && PRIVATE) {
  try { webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE); configured = true; } catch { configured = false; }
}

export function pushConfigured() { return configured; }

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Send a Web Push to every device a user has registered.
// payload = { title, body, url?, tag? }. Best-effort, never throws; prunes subscriptions the push
// service reports as gone (HTTP 404/410) so the table self-heals.
export async function sendPushToUser(userId, payload) {
  if (!configured || !userId) return { sent: 0, failed: 0 };
  const sb = serviceClient();
  const { data: subs } = await sb
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs?.length) return { sent: 0, failed: 0 };

  const body = JSON.stringify(payload || {});
  const dead = [];
  let sent = 0, failed = 0;

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: 3600, urgency: "normal" }
      );
      sent++;
    } catch (e) {
      failed++;
      const code = e && e.statusCode;
      if (code === 404 || code === 410) dead.push(s.id);
    }
  }));

  if (dead.length) { try { await sb.from("push_subscriptions").delete().in("id", dead); } catch { /* best-effort */ } }
  return { sent, failed };
}
