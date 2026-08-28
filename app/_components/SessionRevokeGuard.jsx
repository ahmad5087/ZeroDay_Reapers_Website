"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

// Signs THIS device out when its user_devices row is revoked from another device.
// - Realtime: an active session is signed out the moment another device revokes it.
// - Initial check (page load only): a session resumed after being revoked while offline is
//   signed out. A fresh sign-in never hits the initial check (register_device clears the flag).
export default function SessionRevokeGuard() {
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let channel = null;
    let subscribedFor = null;
    let authSubscription = null;

    const myDevice = () => { try { return localStorage.getItem("zdr_device_id"); } catch { return null; } };

    async function initialCheck(uid) {
      const did = myDevice();
      if (!did) return;
      const { data } = await supabase.from("user_devices")
        .select("revoked_at").eq("user_id", uid).eq("device_id", did).maybeSingle();
      if (data?.revoked_at) supabase.auth.signOut();
    }

    function subscribe(uid) {
      if (subscribedFor === uid) return;
      subscribedFor = uid;
      channel = supabase.channel(`devices:${uid}`)
        .on("postgres_changes",
          { event: "*", schema: "public", table: "user_devices", filter: `user_id=eq.${uid}` },
          (payload) => {
            const row = payload.new || payload.record;
            if (row && row.device_id === myDevice() && row.revoked_at) supabase.auth.signOut();
          })
        .subscribe();
    }

    // Existing session at page load → subscribe + initial check.
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      if (data?.user) { subscribe(data.user.id); initialCheck(data.user.id); }
      // Later sign-in → subscribe only (no initial check → no race with register_device).
      const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
        if (s?.user) subscribe(s.user.id);
        else if (channel) { supabase.removeChannel(channel); channel = null; subscribedFor = null; }
      });
      authSubscription = sub.subscription;
    });

    return () => {
      active = false;
      authSubscription?.unsubscribe();
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  return null;
}
