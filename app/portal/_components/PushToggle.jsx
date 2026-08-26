"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Web Push opt-in (Phase 17), mounted in ProfileScreen next to Passkeys. Fully gated on
// NEXT_PUBLIC_VAPID_PUBLIC_KEY — with no key the whole control renders null. Works on Android + desktop
// in-browser; on iOS the site must be installed to the Home Screen (iOS 16.4+), which we detect + explain.
const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

async function authedPost(path, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

export default function PushToggle() {
  const [supported, setSupported] = useState(true);
  const [subscribed, setSubscribed] = useState(false);
  const [perm, setPerm] = useState("default");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const isIOS = typeof navigator !== "undefined" && /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = typeof window !== "undefined"
    && ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator?.standalone === true);

  useEffect(() => {
    const ready = typeof window !== "undefined"
      && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ready);
    if (!ready) return;
    setPerm(Notification.permission);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(!!sub))
      .catch(() => {});
  }, []);

  async function enable() {
    setErr(""); setOk(""); setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setPerm(permission);
      if (permission !== "granted") {
        setErr("Permission denied. Allow notifications for this site in your browser settings.");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      });
      const r = await authedPost("/api/push/subscribe", { subscription: sub.toJSON() });
      if (!r.ok) throw new Error(r.json.error || "Could not save the subscription");
      setSubscribed(true); setOk("Notifications enabled ✅");
    } catch (e) {
      setErr(e.message || "Could not enable notifications.");
    } finally { setBusy(false); }
  }

  async function disable() {
    setErr(""); setOk(""); setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await authedPost("/api/push/unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
      setSubscribed(false); setOk("Notifications turned off.");
    } catch (e) {
      setErr(e.message || "Could not turn off notifications.");
    } finally { setBusy(false); }
  }

  async function sendTest() {
    setErr(""); setOk(""); setBusy(true);
    const r = await authedPost("/api/push/test");
    if (!r.ok) setErr(r.json.error || "Test failed.");
    else setOk(`Test sent to ${r.json.sent} device${r.json.sent === 1 ? "" : "s"}.` + (r.json.sent === 0 ? " Enable notifications first." : ""));
    setBusy(false);
  }

  if (!VAPID) return null; // push not configured on this deploy → hide entirely

  return (
    <section className="panel border border-blood/20 p-6 rounded-sm shadow-xl">
      <h3 className="text-sm font-bold uppercase tracking-widest text-white border-b border-neutral-800 pb-3 mb-4 flex items-center gap-2">🔔 Push Notifications</h3>
      {err && <p className="text-sm text-blood mb-3">{err}</p>}
      {ok && <p className="text-sm text-[#34d399] mb-3">{ok}</p>}

      <div className="space-y-3 max-w-lg">
        <p className="text-xs text-neutral-500">
          Get alerts for new tasks, feedback, and announcements — even when the app is closed.
          {isIOS && !standalone && " On iPhone/iPad, first add this site to your Home Screen (Share → Add to Home Screen), then open it from there."}
        </p>

        {!supported ? (
          <p className="text-xs text-neutral-500">
            Your browser doesn&apos;t support push notifications{isIOS && !standalone ? " until the site is installed to your Home Screen" : ""}.
          </p>
        ) : perm === "denied" ? (
          <p className="text-xs text-amber-400">Notifications are blocked for this site. Re-enable them in your browser&apos;s site settings, then reload.</p>
        ) : (
          <div className="flex gap-2 flex-wrap items-center">
            {subscribed ? (
              <>
                <button disabled={busy} onClick={disable} className="text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition disabled:opacity-50">Turn off</button>
                <button disabled={busy} onClick={sendTest} className="text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition disabled:opacity-50">Send test</button>
              </>
            ) : (
              <button disabled={busy} onClick={enable} className="btn-neon text-xs uppercase tracking-widest px-4 py-2 rounded-sm disabled:opacity-50">Enable notifications</button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
