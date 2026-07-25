import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Surfaced in the UI if env vars are missing (see portal page).
export const supabaseConfigured = Boolean(url && anon);

// ponytail: single browser client; realtime + auth share it.
export const supabase = supabaseConfigured
  ? createClient(url, anon, { realtime: { params: { eventsPerSecond: 10 } } })
  : null;
