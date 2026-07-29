"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useIdleLogout } from "@/lib/useIdleLogout";

// Global idle auto-logout. Mounted once in the root layout; only activates when there's an
// authenticated session, so it's inert on public pages. Signs out after 10 min of inactivity,
// with a 1-minute "still there?" warning.
export default function IdleGuard() {
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setHasSession(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setHasSession(!!s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const { warning, stay } = useIdleLogout({
    enabled: hasSession,
    timeoutMs: 10 * 60 * 1000,
    warnMs: 60 * 1000,
    onLogout: () => { if (supabase) supabase.auth.signOut(); },
  });

  if (!warning) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 font-mono">
      <div className="max-w-sm w-full bg-ink-900 border border-amber-500/50 rounded-sm p-6 text-center space-y-4 shadow-2xl">
        <div className="text-3xl">⏳</div>
        <h2 className="text-sm uppercase tracking-widest text-amber-400 font-bold">Still there?</h2>
        <p className="text-xs text-neutral-400 leading-relaxed">
          You've been inactive. For your security you'll be signed out in about a minute.
        </p>
        <button onClick={stay} className="w-full bg-blood text-ink-950 uppercase tracking-widest text-xs py-2.5 rounded-sm hover:bg-blood-glow transition">
          Stay signed in
        </button>
      </div>
    </div>
  );
}
