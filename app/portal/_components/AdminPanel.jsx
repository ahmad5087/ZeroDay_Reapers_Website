"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function AdminPanel({ onBack }) {
  const [domains, setDomains] = useState([]);
  const [members, setMembers] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [ann, setAnn] = useState({ title: "", body: "" });
  const [err, setErr] = useState("");

  async function loadMembers() {
    const { data } = await supabase.from("profiles")
      .select("id,display_name,email,role,banned,domain_id")
      .order("created_at", { ascending: true });
    setMembers(data || []);
  }
  async function loadAnn() {
    const { data } = await supabase.from("announcements").select("*").order("created_at", { ascending: false });
    setAnnouncements(data || []);
  }

  useEffect(() => {
    supabase.from("domains").select("id,name,key").order("sort").then(({ data }) => setDomains(data || []));
    loadMembers();
    loadAnn();
  }, []);

  async function setDomain(userId, domainId) {
    setErr("");
    const { error } = await supabase.rpc("admin_set_domain", { target: userId, new_domain: Number(domainId) });
    if (error) return setErr(error.message);
    loadMembers();
  }
  async function setBan(userId, isBanned) {
    setErr("");
    const { error } = await supabase.rpc("admin_set_ban", { target: userId, is_banned: isBanned });
    if (error) return setErr(error.message);
    loadMembers();
  }
  async function postAnn(e) {
    e.preventDefault();
    setErr("");
    if (!ann.title.trim() || !ann.body.trim()) return;
    const { error } = await supabase.from("announcements").insert({ title: ann.title.trim(), body: ann.body.trim() });
    if (error) return setErr(error.message);
    setAnn({ title: "", body: "" });
    loadAnn();
  }
  async function delAnn(id) {
    await supabase.from("announcements").delete().eq("id", id);
    loadAnn();
  }

  const input = "bg-ink-900 border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-sm";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-black border-b border-blood/20">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-3">
          <span className="font-mono text-sm tracking-widest text-white text-glow">ADMIN · ZERO<span className="text-blood">DAY</span> REAPERS</span>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back to chat
          </button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-12">
        {err && <p className="font-mono text-sm text-blood">{err}</p>}

        {/* Members */}
        <section>
          <h2 className="font-mono text-xl text-white mb-4">Members ({members.length})</h2>
          <div className="overflow-x-auto border border-blood/20 rounded-sm">
            <table className="w-full text-sm font-mono">
              <thead className="bg-ink-900 text-neutral-500 uppercase text-xs tracking-widest">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Email</th>
                  <th className="text-left px-4 py-3">Domain</th>
                  <th className="text-left px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-t border-blood/10">
                    <td className="px-4 py-3 text-white">
                      {m.display_name} {m.role === "admin" && <span className="text-blood text-xs">(admin)</span>}
                    </td>
                    <td className="px-4 py-3 text-neutral-400">{m.email}</td>
                    <td className="px-4 py-3">
                      <select className={input} value={m.domain_id || ""} onChange={(e) => setDomain(m.id, e.target.value)}>
                        <option value="" disabled>—</option>
                        {domains.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {m.banned ? (
                        <button onClick={() => setBan(m.id, false)} className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1.5 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition">
                          Unban
                        </button>
                      ) : (
                        <button onClick={() => setBan(m.id, true)} className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1.5 rounded-sm hover:bg-blood hover:text-ink-950 transition">
                          Ban
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Announcements */}
        <section>
          <h2 className="font-mono text-xl text-white mb-4">Announcements</h2>
          <form onSubmit={postAnn} className="space-y-3 max-w-xl mb-6">
            <input className={`${input} w-full`} placeholder="Title" value={ann.title} onChange={(e) => setAnn((a) => ({ ...a, title: e.target.value }))} />
            <textarea className={`${input} w-full`} rows={3} placeholder="Body" value={ann.body} onChange={(e) => setAnn((a) => ({ ...a, body: e.target.value }))} />
            <button className="bg-blood text-ink-950 font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition">
              Post announcement
            </button>
          </form>
          <div className="space-y-3">
            {announcements.map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-4 border border-blood/20 rounded-sm p-4">
                <div>
                  <div className="font-mono text-white">{a.title}</div>
                  <div className="text-sm text-neutral-400">{a.body}</div>
                </div>
                <button onClick={() => delAnn(a.id)} className="font-mono text-xs text-neutral-500 hover:text-blood shrink-0">delete</button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
