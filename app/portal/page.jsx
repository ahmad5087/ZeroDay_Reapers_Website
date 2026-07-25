"use client";

import { useEffect, useState } from "react";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import AuthScreen from "./_components/AuthScreen";
import ChatScreen from "./_components/ChatScreen";
import AdminPanel from "./_components/AdminPanel";

export default function PortalPage() {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null);
  const [view, setView] = useState("chat");

  useEffect(() => {
    if (!supabaseConfigured) { setReady(true); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (!s) setMe(null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Load profile when signed in.
  useEffect(() => {
    if (!session) return;
    let tries = 0;
    let stop = false;
    async function load() {
      const { data } = await supabase.from("profiles").select("*, domains(name,key)").eq("id", session.user.id).single();
      if (stop) return;
      if (data) { setMe(data); return; }
      // profile row may lag the auth trigger on first signup — retry briefly
      if (tries++ < 5) setTimeout(load, 600);
    }
    load();
    return () => { stop = true; };
  }, [session]);

  async function signOut() {
    await supabase.auth.signOut();
    setMe(null); setView("chat");
  }

  if (!ready) return <Center>Loading…</Center>;
  if (!supabaseConfigured) return <ConfigNeeded />;
  if (!session) return <AuthScreen />;
  if (!me) return <Center>Loading your profile…</Center>;
  if (!me.domain_id) return <DomainPicker me={me} onDone={setMe} />;

  if (view === "admin" && me.role === "admin") return <AdminPanel onBack={() => setView("chat")} />;
  return <ChatScreen me={me} setMe={setMe} onSignOut={signOut} onOpenAdmin={() => setView("admin")} />;
}

function Center({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="font-mono text-xs uppercase tracking-widest text-neutral-500 animate-pulse">{children}</p>
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
    supabase.from("domains").select("id,name,key").neq("key", "lobby").order("sort")
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
        <select className="w-full bg-ink-900 border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm"
          value={domainId} onChange={(e) => setDomainId(e.target.value)} required>
          <option value="">Choose…</option>
          {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button className="w-full bg-blood text-ink-950 uppercase tracking-widest py-3 rounded-sm hover:bg-blood-glow transition">
          Enter portal →
        </button>
      </form>
    </div>
  );
}
