"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

// Referral capture (Phase 11). Records a `?ref=CODE` from any landing into localStorage, then attributes
// it to the user once they have a session (on load and on sign-in). `attribute_referral` is a no-op for
// self / already-attributed / unknown codes, so this is safe to run everywhere. Renders nothing.
export default function RefCapture() {
  useEffect(() => {
    try {
      const ref = new URL(window.location.href).searchParams.get("ref");
      if (ref) localStorage.setItem("zdr.ref", ref.slice(0, 32));
    } catch { /* ignore */ }

    if (!supabase) return;
    const attribute = async () => {
      let code = null;
      try { code = localStorage.getItem("zdr.ref"); } catch { /* ignore */ }
      if (!code) return;
      const { data: { session } = { session: null } } = await supabase.auth.getSession();
      if (!session) return;
      try { await supabase.rpc("attribute_referral", { p_code: code }); } catch { /* RPC not deployed / no-op */ }
      try { localStorage.removeItem("zdr.ref"); } catch { /* ignore */ }
    };
    let active = true;
    let subscription = null;
    supabase.auth.getSession().then(() => {
      if (!active) return;
      attribute();
      const { data: sub } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_IN") setTimeout(attribute, 0);
      });
      subscription = sub.subscription;
    });
    return () => { active = false; subscription?.unsubscribe(); };
  }, []);

  return null;
}
