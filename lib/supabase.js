import { createClient } from "@supabase/supabase-js";
import { AUTH_OPERATION_TIMEOUT_MS, AuthOperationTimeoutError } from "./auth-timeout";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Surfaced in the UI if env vars are missing (see portal page).
export const supabaseConfigured = Boolean(url && anon);

// Abort only Supabase Auth HTTP calls. A stalled password/token request must not
// leave the login button spinning forever, while storage uploads and ordinary
// database queries retain their own (potentially longer) lifetimes.
async function boundedSupabaseFetch(input, init = {}) {
  const requestUrl = typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
  if (!requestUrl.includes("/auth/v1/")) return globalThis.fetch(input, init);

  const controller = new AbortController();
  const upstreamSignal = init.signal || input?.signal;
  const relayAbort = () => controller.abort(upstreamSignal?.reason);

  if (upstreamSignal?.aborted) relayAbort();
  else upstreamSignal?.addEventListener?.("abort", relayAbort, { once: true });

  const timer = setTimeout(() => controller.abort(new AuthOperationTimeoutError()), AUTH_OPERATION_TIMEOUT_MS);
  try {
    return await globalThis.fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    upstreamSignal?.removeEventListener?.("abort", relayAbort);
  }
}

// ponytail: single browser client; realtime + auth share it.
export const supabase = supabaseConfigured
  ? createClient(url, anon, {
      global: { fetch: boundedSupabaseFetch },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;
