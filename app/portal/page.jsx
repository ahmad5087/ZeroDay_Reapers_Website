"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import AuthScreen from "./_components/AuthScreen";
import ChatScreen from "./_components/ChatScreen";
import AdminPanel from "./_components/AdminPanel";
import TasksScreen from "./_components/TasksScreen";
import DocumentsScreen from "./_components/DocumentsScreen";
import DMScreen from "./_components/DMScreen";
import { ProfileScreen } from "./_components/ProfileScreen";
import DashboardScreen from "./_components/DashboardScreen";
import CalendarScreen from "./_components/CalendarScreen";
import ActivityScreen from "./_components/ActivityScreen";
import FeedbackScreen from "./_components/FeedbackScreen";
import PaymentScreen from "./_components/PaymentScreen";
import MentorScreen from "./_components/MentorScreen";
import NotificationsScreen from "./_components/NotificationsScreen";
import SearchScreen from "./_components/SearchScreen";
import Require2FA from "./_components/Require2FA";
import ResourceLibrary from "./_components/ResourceLibrary";
import OfficeHours from "./_components/OfficeHours";
import PasskeyGate from "./_components/PasskeyGate";
import OpportunitiesBoard from "./_components/OpportunitiesBoard";
import FeeReminderPopup from "./_components/FeeReminderPopup";
import LateComerPopup from "./_components/LateComerPopup";
import AnnouncementPopup from "./_components/AnnouncementPopup";
import { emailSelf } from "@/lib/notify";

export default function PortalPage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null);
  const [view, setView] = useState("chat");
  const [online, setOnline] = useState(new Set());
  const [passkeyOk, setPasskeyOk] = useState(false); // passkey step-up satisfied this session
  const [noProfile, setNoProfile] = useState(false);
  const [admin2FA, setAdmin2FA] = useState(null); // admins only: null=checking, "ok", "need"
  const [features, setFeatures] = useState({}); // feature_flags: { key: enabled } — gates roadmap features

  // Register/refresh this browser as a known device: approximate city/country (resolved server-side via
  // /api/geo — reliable, not blocked by ad-blockers), a best-effort device model (Android Client Hints;
  // iPhone/laptop don't expose one), and the user agent. Emails the user only on a genuinely NEW device
  // (register_device returns is_new). Idempotent — safe to call once per day per browser.
  async function syncDevice(notifyIfNew) {
    try {
      let deviceId = localStorage.getItem("zdr_device_id");
      if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem("zdr_device_id", deviceId); }
      let city = null, country = null, model = null;
      try {
        const g = await fetch("/api/geo", { cache: "no-store" });
        if (g.ok) { const j = await g.json(); city = j.city || null; country = j.country || null; }
      } catch { /* location is optional */ }
      try {
        if (navigator.userAgentData?.getHighEntropyValues) {
          const hints = await navigator.userAgentData.getHighEntropyValues(["model"]);
          model = hints.model || null; // e.g. "SM-G975F" / "Pixel 7" on Android; "" on desktop/iOS
        }
      } catch { /* model is optional */ }
      const { data } = await supabase.rpc("register_device", {
        p_device_id: deviceId, p_user_agent: navigator.userAgent, p_city: city, p_country: country, p_model: model,
      });
      if (data === true && notifyIfNew) {
        supabase.rpc("log_my_activity", { p_type: "new_device", p_meta: { ua: navigator.userAgent, city, country, model } });
        const where = [city, country].filter(Boolean).join(", ");
        emailSelf("New sign-in to your ZeroDay Reapers account",
          `<p>A new device just signed in to your account.</p><p><b>Device:</b> ${model ? model + " — " : ""}${navigator.userAgent}</p>${where ? `<p><b>Approx. location:</b> ${where}</p>` : ""}<p>If this wasn't you, change your password and enable two-factor authentication immediately.</p>`);
      }
      return true;
    } catch { return false; /* device sync is best-effort */ }
  }

  useEffect(() => {
    if (!supabaseConfigured) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setMe(null);
      // Log a login event once per browser session (fires on real sign-in, not refresh).
      if (_e === "SIGNED_IN" && s) {
        try {
          const loginKey = `zdr_logged_login:${s.user.id}`;
          if (!sessionStorage.getItem(loginKey)) {
            supabase.rpc("log_my_activity", { p_type: "login" }).then(({ error }) => {
              if (!error) sessionStorage.setItem(loginKey, "1");
            });
            // Device registration (with location/model) happens in the profile-load effect below, gated
            // once per PKT day — so it also backfills returning sessions that don't fire a fresh SIGNED_IN.
          }
        } catch { /* ignore */ }
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load profile when signed in.
  useEffect(() => {
    if (!session) return;
    let tries = 0;
    let stop = false;
    setNoProfile(false);
    async function load() {
      // Primary: profile + its domain in one round-trip.
      let { data, error } = await supabase.from("profiles").select("*, domains(name,key)").eq("id", session.user.id).maybeSingle();
      // If the query errored (e.g. the domains embed fails after a migration reloads the PostgREST
      // schema cache), don't lock the user out — fetch the bare profile and its domain separately.
      if (!data && error) {
        const bare = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
        if (bare.data) {
          data = bare.data;
          if (data.domain_id) {
            const dom = await supabase.from("domains").select("name,key").eq("id", data.domain_id).maybeSingle();
            if (dom.data) data = { ...data, domains: dom.data };
          }
        }
      }
      if (stop) return;
      if (data) {
        setMe(data);
        // Refresh device metadata once per PKT day PER USER. The marker is written only after the RPC
        // succeeds, so a transient failure can retry instead of suppressing updates for the whole day.
        try {
          const pktDay = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
          const syncKey = `zdr_daily_sync:${data.id}`;
          if (localStorage.getItem(syncKey) !== pktDay) {
            syncDevice(true).then((synced) => {
              if (synced) localStorage.setItem(syncKey, pktDay);
            });
          }
        } catch { /* best-effort */ }
        return;
      }
      // profile row may lag the auth trigger on first signup — retry briefly
      if (tries++ < 5) setTimeout(load, 600);
      // exhausted: session exists but genuinely no profile row (e.g. account deleted by admin)
      else setNoProfile(true);
    }
    load();
    return () => { stop = true; };
  }, [session]);

  // Reliable intern activity heartbeat. The database is idempotent per PKT day and refreshes a
  // last-seen timestamp, so there is no fragile localStorage gate. Retry on focus/visibility plus a
  // five-minute interval; this also makes "Active today" agree with users who are visibly online.
  useEffect(() => {
    if (!me || me.role === "admin") return;
    let stopped = false;
    const markActive = async () => {
      if (stopped || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
      await supabase.rpc("mark_active_today");
    };
    const onVisible = () => { if (document.visibilityState === "visible") markActive(); };
    markActive();
    const timer = setInterval(markActive, 5 * 60 * 1000);
    window.addEventListener("focus", markActive);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener("focus", markActive);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [me?.id, me?.role]);

  useEffect(() => {
    if (!me) return;
    const ch = supabase.channel("portal-presence", { config: { presence: { key: me.id } } })
      .on("presence", { event: "sync" }, () => {
        const state = ch.presenceState();
        setOnline(new Set(Object.keys(state)));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") ch.track({ user_id: me.id, display_name: me.display_name });
      });
    return () => { supabase.removeChannel(ch); };
  }, [me?.id]);

  // Admins must have a verified 2FA factor — check on load.
  useEffect(() => {
    if (!me || me.role !== "admin") { setAdmin2FA("ok"); return; }
    supabase.auth.mfa.listFactors().then(({ data }) => {
      const verified = (data?.totp || []).some((f) => f.status === "verified");
      setAdmin2FA(verified ? "ok" : "need");
    });
  }, [me?.id, me?.role]);

  useEffect(() => {
    supabase.from("feature_flags").select("key,enabled")
      .then(({ data }) => setFeatures(Object.fromEntries((data || []).map((f) => [f.key, f.enabled]))));
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setMe(null); setView("chat");
  }

  if (!ready) return <Center>Loading…</Center>;
  if (!supabaseConfigured) return <ConfigNeeded />;
  if (!session) return <AuthScreen />;
  if (!me) return noProfile ? <NoProfile onSignOut={signOut} /> : <Center>Loading your profile…</Center>;
  if (me.role !== "admin" && me.status === "pending") return <PendingApprovalScreen me={me} onSignOut={signOut} />;
  if (me.role !== "admin" && me.status === "rejected") return <RejectedScreen me={me} onSignOut={signOut} />;
  // Admins have no domain — send them to a domain picker only for students.
  if (!me.domain_id && me.role !== "admin") return <DomainPicker me={me} onDone={setMe} />;

  // Enforce admin 2FA before any admin access.
  if (me.role === "admin") {
    if (admin2FA === null) return <Center>Checking security…</Center>;
    if (admin2FA === "need") return <Require2FA onDone={() => setAdmin2FA("ok")} onSignOut={signOut} />;
  }

  if (features.passkeys && me.passkey_required && !passkeyOk && typeof window !== "undefined" && !sessionStorage.getItem(`zdr_passkey_ok:${me.id}`)) {
    return <PasskeyGate me={me} onDone={() => { try { sessionStorage.setItem(`zdr_passkey_ok:${me.id}`, "1"); } catch {} setPasskeyOk(true); }} onSignOut={signOut} />;
  }

  if (view === "dashboard") {
    // Alumni keep the Dashboard (badges-only view handled inside DashboardScreen).
    return <DashboardScreen me={me} onBack={() => setView("chat")} onOpenTasks={() => setView("tasks")} />;
  }
  if (view === "tasks") {
    if (me.is_alumni && me.role !== "admin") return <AlumniNoticeScreen me={me} onBack={() => setView("chat")} />;
    return <TasksScreen me={me} onBack={() => setView("chat")} />;
  }
  if (view === "docs") {
    // Alumni keep access to their documents.
    return <DocumentsScreen me={me} onBack={() => setView("chat")} />;
  }
  if (view === "calendar") {
    if (me.is_alumni && me.role !== "admin") return <AlumniNoticeScreen me={me} onBack={() => setView("chat")} />;
    return <CalendarScreen me={me} onBack={() => setView("chat")} onOpenTasks={() => setView("tasks")} />;
  }
  if (view === "activity") return <ActivityScreen me={me} onBack={() => setView("chat")} />;
  if (view === "mentor") return <MentorScreen me={me} onBack={() => setView("chat")} />;
  if (view === "notifications") return <NotificationsScreen me={me} onBack={() => setView("chat")} onOpenTasks={() => setView("tasks")} onOpenDM={() => setView("dm")} />;
  if (view === "search") return <SearchScreen me={me} onBack={() => setView("chat")} onOpenTasks={() => setView("tasks")} onOpenDocs={() => setView("docs")} onOpenAdmin={() => setView("admin")} />;
  if (view === "feedback") return <FeedbackScreen me={me} onBack={() => setView("chat")} />;
  if (view === "resources" && features.resource_library) return <ResourceLibrary me={me} onBack={() => setView("chat")} />;
  if (view === "office_hours" && features.office_hours) return <OfficeHours me={me} onBack={() => setView("chat")} />;
  if (view === "opportunities" && features.alumni_board) return <OpportunitiesBoard me={me} onBack={() => setView("chat")} />;
  if (view === "payment") return <PaymentScreen me={me} onBack={() => setView("chat")} onGoToProfile={() => setView("profile")} />;
  if (view === "dm") return <DMScreen me={me} onBack={() => setView("chat")} />;
  if (view === "profile") return <ProfileScreen me={me} setMe={setMe} onBack={() => setView("chat")} />;
  if (view === "admin" && me.role === "admin") return <AdminPanel me={me} setMe={setMe} online={online} onBack={() => setView("chat")} />;
  return (
    <>
      <ChatScreen me={me} setMe={setMe} online={online} onSignOut={signOut} onOpenAdmin={() => setView("admin")} onOpenTasks={() => setView("tasks")} onOpenDocs={() => setView("docs")} onOpenDM={() => setView("dm")} onOpenProfile={() => setView("profile")} onOpenDashboard={() => setView("dashboard")} onOpenCalendar={() => setView("calendar")} onOpenActivity={() => setView("activity")} onOpenMentor={() => setView("mentor")} onOpenNotifications={() => setView("notifications")} onOpenSearch={() => setView("search")} onOpenFeedback={() => setView("feedback")} onOpenResources={features.resource_library ? () => setView("resources") : null} onOpenOfficeHours={features.office_hours ? () => setView("office_hours") : null} onOpenOpportunities={features.alumni_board ? () => setView("opportunities") : null} onOpenPayment={() => setView("payment")} />
      <FeeReminderPopup me={me} onGoToProfile={() => setView("profile")} />
      <LateComerPopup me={me} setMe={setMe} />
      <AnnouncementPopup me={me} setMe={setMe} />
    </>
  );
}

function Center({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 animate-pulse">{children}</p>
    </div>
  );
}

function NoProfile({ onSignOut }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-sm border border-blood/30 rounded-sm p-8 text-center font-mono text-sm">
        <h1 className="text-white text-lg mb-3">Account not found</h1>
        <p className="text-neutral-400 mb-6 leading-relaxed">
          This account has no profile — it was likely removed by an admin. Sign out and register again, or contact the team if this is a mistake.
        </p>
        <button onClick={onSignOut} className="border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition uppercase tracking-widest text-xs">
          Sign out
        </button>
      </div>
    </div>
  );
}

function ConfigNeeded() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="max-w-md border border-blood/30 rounded-sm p-8 font-mono text-sm text-neutral-300">
        <h1 className="text-white text-lg mb-3">Portal not configured</h1>
        <p className="text-neutral-400 leading-relaxed">
          Set <code className="text-blood">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-blood">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> in your environment,
          then redeploy. See <code className="text-blood">PORTAL_SETUP.md</code>.
        </p>
      </div>
    </div>
  );
}

function DomainPicker({ me, onDone }) {
  const [domains, setDomains] = useState([]);
  const [domainId, setDomainId] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase.from("domains").select("id,name,key").not("key", "in", "(lobby,alumni)").order("sort")
      .then(({ data }) => setDomains(data || []));
  }, []);

  async function save(e) {
    e.preventDefault();
    if (!domainId) return;
    const { error } = await supabase.from("profiles").update({ domain_id: Number(domainId) }).eq("id", me.id);
    if (error) return setErr(error.message);
    onDone({ ...me, domain_id: Number(domainId) });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={save} className="w-full max-w-sm border border-blood/20 rounded-sm p-8 space-y-4 font-mono text-sm">
        <h1 className="text-white text-lg">Choose your domain</h1>
        <p className="text-neutral-500 text-xs">You can only pick once. An admin can move you later.</p>
        {err && <p className="text-blood text-xs">{err}</p>}
        <select className="w-full panel border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm"
          value={domainId} onChange={(e) => setDomainId(e.target.value)} required>
          <option value="">Choose…</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button className="w-full btn-neon uppercase tracking-widest py-3 rounded-sm hover:bg-blood-glow transition">
          Enter portal →
        </button>
      </form>
    </div>
  );
}

function PendingApprovalScreen({ me, onSignOut }) {
  return (
    <div className="min-h-screen text-neutral-100 flex flex-col items-center justify-center p-6 text-center font-mono">
      <div className="max-w-md w-full panel border border-amber-500/40 p-8 rounded-sm space-y-6 shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500 flex items-center justify-center mx-auto text-amber-400 text-xl animate-pulse">
          ⏳
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold tracking-wider uppercase text-white">Account Pending Approval</h2>
          <p className="text-xs text-neutral-400 leading-relaxed">
            Welcome, <span className="text-neutral-200 font-semibold">{me.display_name}</span>. Your registration has been received and is currently under review by the ZeroDay Reaper administration team.
          </p>
          <p className="text-xs text-neutral-500 pt-2">
            Once your account is approved, you will gain full access to your department chat room, tasks, and direct messaging.
          </p>
        </div>
        <div className="pt-4 border-t border-neutral-800">
          <button
            onClick={onSignOut}
            className="w-full text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 py-2.5 rounded-sm hover:border-amber-500 hover:text-amber-400 transition"
          >
            Sign Out & Return Later
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectedScreen({ me, onSignOut }) {
  return (
    <div className="min-h-screen text-neutral-100 flex flex-col items-center justify-center p-6 text-center font-mono">
      <div className="max-w-md w-full panel border border-red-500/50 p-8 rounded-sm space-y-6 shadow-2xl">
        <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500 flex items-center justify-center mx-auto text-red-500 text-xl">
          ✕
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold tracking-wider uppercase text-red-400">Application Rejected</h2>
          <p className="text-xs text-neutral-400 leading-relaxed">
            We regret to inform you that your registration (<span className="text-neutral-200">{me.email}</span>) has been declined by the administration team.
          </p>
        </div>
        <div className="pt-4 border-t border-neutral-800">
          <button
            onClick={onSignOut}
            className="w-full text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 py-2.5 rounded-sm hover:border-red-500 hover:text-red-400 transition"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function AlumniNoticeScreen({ me, onBack }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      <div className="max-w-md w-full bg-neutral-950 border border-[#38bdf8]/40 p-6 rounded-sm text-center space-y-4">
        <div className="text-4xl">🎓</div>
        <h2 className="font-mono text-lg text-white uppercase tracking-widest font-bold">Alumni Status</h2>
        <p className="text-sm text-neutral-300 font-mono">
          Congratulations, <span className="text-[#38bdf8] font-bold">{me.display_name}</span>! You have successfully completed the 6-week internship and graduated to the Alumni Group.
        </p>
        <p className="text-xs text-neutral-400 font-mono">
          Your internship task deliverables and document uploads have been archived as per the 75-day retention policy. You now have exclusive access to the Alumni Group!
        </p>
        <button onClick={onBack}
          className="w-full font-mono text-xs uppercase tracking-widest bg-[#38bdf8] text-ink-950 font-bold px-4 py-2.5 rounded-sm hover:opacity-90 transition">
          ← Return to Alumni Chat
        </button>
      </div>
    </div>
  );
}
