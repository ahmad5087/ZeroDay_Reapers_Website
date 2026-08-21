"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { pktLocalInputToISO, fmtLocalAndPKT } from "../_lib";

// Admin office-hours management (Phase 4). Publish limited-capacity slots (via the admin-write RLS on
// office_hour_slots, like live_sessions), see each slot's bookings + questions, and mark attendance.
const EMPTY = { mentor_id: "", starts_at: "", ends_at: "", capacity: "1", join_url: "", location: "", domain_id: "", notes: "" };

export default function OfficeHoursAdmin({ me, members = [], domains = [] }) {
  const input = "panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-sm";
  const [slots, setSlots] = useState([]);
  const [form, setForm] = useState({ ...EMPTY, mentor_id: me.id });
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  const admins = members.filter((m) => m.role === "admin");
  const nameOf = (id) => { const m = members.find((x) => x.id === id); return m?.display_name || m?.full_name || "—"; };
  const active = (bk) => (bk || []).filter((b) => b.status !== "cancelled");

  async function load() {
    const { data } = await supabase.from("office_hour_slots")
      .select("*, bookings:office_hour_bookings(id,intern_id,question,status,intern:profiles!office_hour_bookings_intern_id_fkey(display_name,member_id))")
      .order("starts_at", { ascending: true });
    setSlots(data || []);
  }
  useEffect(() => { load(); }, []);

  async function create(e) {
    e.preventDefault();
    if (!form.starts_at) return setErr("Start time is required.");
    setErr(""); setOk(""); setBusy(true);
    const { error } = await supabase.from("office_hour_slots").insert({
      mentor_id: form.mentor_id || null,
      starts_at: pktLocalInputToISO(form.starts_at),
      ends_at: form.ends_at ? pktLocalInputToISO(form.ends_at) : null,
      capacity: Math.max(1, Number(form.capacity) || 1),
      join_url: form.join_url.trim() || null,
      location: form.location.trim() || null,
      domain_id: form.domain_id === "" ? null : Number(form.domain_id),
      notes: form.notes.trim() || null,
      created_by: me.id,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    setOk("Slot published."); setForm({ ...EMPTY, mentor_id: me.id }); load();
  }

  async function del(id) {
    await supabase.from("office_hour_slots").delete().eq("id", id);
    load();
  }
  async function attend(bookingId, status) {
    setErr(""); setOk("");
    const { error } = await supabase.rpc("mark_office_hour_attendance", { p_booking: bookingId, p_status: status });
    if (error) return setErr(error.message);
    load();
  }

  return (
    <section className="space-y-5">
      <h2 className="font-mono text-xl text-white">Office Hours</h2>
      {err && <p className="font-mono text-sm text-blood">{err}</p>}
      {ok && <p className="font-mono text-sm text-[#34d399]">{ok}</p>}

      <form onSubmit={create} className="panel border border-blood/20 rounded-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-[10px] uppercase tracking-widest text-neutral-500">Mentor
          <select className={input + " w-full mt-1"} value={form.mentor_id} onChange={(e) => setForm((s) => ({ ...s, mentor_id: e.target.value }))}>
            {admins.map((m) => <option key={m.id} value={m.id}>{m.display_name || m.full_name}</option>)}
          </select>
        </label>
        <label className="text-[10px] uppercase tracking-widest text-neutral-500">Capacity
          <input type="number" min={1} max={100} className={input + " w-full mt-1"} value={form.capacity} onChange={(e) => setForm((s) => ({ ...s, capacity: e.target.value }))} />
        </label>
        <label className="text-[10px] uppercase tracking-widest text-neutral-500">Starts (PKT)
          <input type="datetime-local" className={input + " w-full mt-1"} value={form.starts_at} onChange={(e) => setForm((s) => ({ ...s, starts_at: e.target.value }))} />
        </label>
        <label className="text-[10px] uppercase tracking-widest text-neutral-500">Ends (PKT, optional)
          <input type="datetime-local" className={input + " w-full mt-1"} value={form.ends_at} onChange={(e) => setForm((s) => ({ ...s, ends_at: e.target.value }))} />
        </label>
        <input className={input} placeholder="Join URL (optional)" value={form.join_url} onChange={(e) => setForm((s) => ({ ...s, join_url: e.target.value }))} />
        <input className={input} placeholder="Location (optional)" value={form.location} onChange={(e) => setForm((s) => ({ ...s, location: e.target.value }))} />
        <select className={input} value={form.domain_id} onChange={(e) => setForm((s) => ({ ...s, domain_id: e.target.value }))}>
          <option value="">All departments</option>
          {domains.filter((d) => !["lobby", "alumni"].includes(d.key)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <input className={input} placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm((s) => ({ ...s, notes: e.target.value }))} />
        <div className="md:col-span-2">
          <button disabled={busy} className="font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm disabled:opacity-50">Publish slot</button>
        </div>
      </form>

      <div className="space-y-3">
        {slots.length === 0 ? <p className="font-mono text-sm text-neutral-500">No slots yet.</p> : slots.map((s) => (
          <div key={s.id} className="border border-blood/20 rounded-sm bg-ink-900/30 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="font-mono text-sm text-white">{fmtLocalAndPKT(s.starts_at)} <span className="text-neutral-600">· {nameOf(s.mentor_id)} · {active(s.bookings).length}/{s.capacity}</span></div>
              <button onClick={() => del(s.id)} className="font-mono text-[10px] uppercase tracking-widest text-neutral-600 hover:text-blood">Delete</button>
            </div>
            {s.notes && <p className="font-mono text-[11px] text-neutral-500 mt-1">{s.notes}</p>}
            <div className="mt-2 divide-y divide-blood/10">
              {active(s.bookings).length === 0 ? <p className="font-mono text-[11px] text-neutral-600 py-2">No bookings.</p> : active(s.bookings).map((b) => (
                <div key={b.id} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs text-white">{b.intern?.display_name || "Intern"} <span className="text-neutral-600">{b.intern?.member_id || ""}</span> <span className="text-[10px] uppercase tracking-widest text-neutral-500">· {b.status}</span></div>
                    {b.question && <p className="font-mono text-[11px] text-neutral-400 mt-0.5">&ldquo;{b.question}&rdquo;</p>}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => attend(b.id, "attended")} className={`font-mono text-[10px] uppercase tracking-widest border px-2 py-1 rounded-sm transition ${b.status === "attended" ? "border-[#34d399] text-[#34d399] bg-[#34d399]/10" : "border-neutral-700 text-neutral-400 hover:border-[#34d399] hover:text-[#34d399]"}`}>Attended</button>
                    <button onClick={() => attend(b.id, "no_show")} className={`font-mono text-[10px] uppercase tracking-widest border px-2 py-1 rounded-sm transition ${b.status === "no_show" ? "border-blood text-blood bg-blood/10" : "border-neutral-700 text-neutral-400 hover:border-blood hover:text-blood"}`}>No-show</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
