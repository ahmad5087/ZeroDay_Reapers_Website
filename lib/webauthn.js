import { createClient } from "@supabase/supabase-js";

// Shared server-side helpers for the WebAuthn route handlers (Phase 5). Node runtime only.

// Relying-Party id + expected origin. RP id defaults to the request host (works in dev + prod);
// override with NEXT_PUBLIC_RP_ID when the portal is served from a subdomain you want to scope to.
export function rpFromReq(req) {
  const rpID = process.env.NEXT_PUBLIC_RP_ID || new URL(req.url).hostname;
  const origin = req.headers.get("origin") || `https://${rpID}`;
  return { rpID, origin };
}

// Identify the caller from their Supabase bearer token (same pattern as /api/notify).
export async function getUserFromReq(req) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return null;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data } = await sb.auth.getUser(token);
  return data?.user || null;
}

// Service-role client for credential/challenge writes (bypasses RLS). Never expose to the browser.
export function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}
