"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { fmtLocalAndPKT } from "../_lib";

// Intern office-hours booking (Phase 4). Browse upcoming slots (RLS shows global + own department),
// book with an optional question (capacity-checked server-side), and cancel. Remaining capacity comes
// from the trigger-maintained slot.booked_count; the intern's own booking is embedded via RLS.
export default function OfficeHours({ me, onBack }) {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [booking, setBooking] = useState(null); // slot pending confirmation
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("office_hour_slots")
      .select("*, mine:office_hour_bookings(id,status,intern_id)")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true });
    setSlots(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [me.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const myBooking = (s) => (s.mine || []).find((b) => b.intern_id === me.id && b.status !== "cancelled");

  async function confirmBook() {
    if (!booking) return;
    setErr(""); setOk(""); setBusy(true);
    const { error } = await supabase.rpc("book_office_hour", { p_slot: booking.id, p_question: question.trim() || null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk("Booked. See you there!"); setBooking(null); setQuestion(""); load();
  }
  async function cancel(bookingId) {
    setErr(""); setOk("");
    const { error } = await supabase.rpc("cancel_office_hour_booking", { p_id: bookingId });
    if (error) return setErr(error.message);
    setOk("Booking cancelled."); load();
  }

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between gap-3">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Office Hours</h1>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">← Chat</button>
        </div>
      </header>

      <main className="w-full max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 font-mono">
        {err && <p className="text-blood text-sm mb-3">{err}</p>}
        {ok && <p className="text-[#34d399] text-sm mb-3">{ok}</p>}

        {loading ? (
          <p className="text-center text-xs uppercase tracking-widest text-neutral-500 animate-pulse py-16">Loading…</p>
        ) : slots.length === 0 ? (
          <p className="text-center text-sm text-neutral-500 py-16">No upcoming office hours. Check back soon.</p>
        ) : (
          <div className="space-y-3">
            {slots.map((s) => {
              const mine = myBooking(s);
              const remaining = Math.max(0, s.capacity - (s.booked_count || 0));
              return (
                <div key={s.id} className={`border rounded-sm p-4 bg-ink-900/30 ${mine ? "border-[#34d399]/40" : "border-blood/20"}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                      <div className="text-sm text-white">{fmtLocalAndPKT(s.starts_at)}</div>
                      <div className="text-[11px] text-neutral-500 mt-0.5">
                        {mine ? "You're booked" : remaining > 0 ? `${remaining} spot${remaining === 1 ? "" : "s"} left` : "Full"}
                        {s.location ? ` · ${s.location}` : ""}
                      </div>
                      {s.notes && <p className="text-[11px] text-neutral-500 mt-1">{s.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {s.join_url && mine && <a href={s.join_url} target="_blank" rel="noopener noreferrer" className="text-[10px] uppercase tracking-widest border border-[#38bdf8]/50 text-[#38bdf8] px-2.5 py-1 rounded-sm hover:bg-[#38bdf8] hover:text-ink-950 transition">Join</a>}
                      {mine ? (
                        <button onClick={() => cancel(mine.id)} className="text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1 rounded-sm hover:border-blood hover:text-blood transition">Cancel</button>
                      ) : remaining > 0 ? (
                        <button onClick={() => { setBooking(s); setQuestion(""); }} className="text-[10px] uppercase tracking-widest btn-neon px-2.5 py-1 rounded-sm">Book</button>
                      ) : (
                        <span className="text-[10px] uppercase tracking-widest text-neutral-600 px-2.5 py-1">Full</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => !busy && setBooking(null)}>
          <div className="w-full max-w-md border border-blood/30 bg-ink-950 rounded-sm p-6 space-y-4 font-mono" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm uppercase tracking-widest text-white">Book this slot</h3>
            <p className="text-xs text-neutral-400">{fmtLocalAndPKT(booking.starts_at)}</p>
            <label className="block text-[10px] uppercase tracking-widest text-neutral-500">Your question (optional)
              <textarea rows={4} maxLength={1000} value={question} onChange={(e) => setQuestion(e.target.value)}
                placeholder="What would you like help with?"
                className="w-full mt-1 panel border border-blood/30 focus:border-blood outline-none rounded-sm px-3 py-2 text-sm text-neutral-100 resize-y" />
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setBooking(null)} disabled={busy} className="text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition disabled:opacity-50">Cancel</button>
              <button onClick={confirmBook} disabled={busy} className="text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm disabled:opacity-50">{busy ? "Booking…" : "Confirm"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
