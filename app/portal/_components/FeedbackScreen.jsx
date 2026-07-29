"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useDraft } from "@/lib/useDraft";

function Stars({ value, onChange, readOnly = false, size = "text-2xl" }) {
  return (
    <div className={`flex gap-1 ${size}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={readOnly}
          onClick={() => !readOnly && onChange?.(n)}
          className={`${n <= value ? "text-amber-400" : "text-neutral-700"} ${readOnly ? "cursor-default" : "hover:text-amber-300 cursor-pointer"}`}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
        >
          ★
        </button>
      ))}
    </div>
  );
}

const STATUS_STYLE = {
  pending: "text-amber-400",
  approved: "text-[#34d399]",
  rejected: "text-blood",
};

export default function FeedbackScreen({ me, onBack }) {
  const isAlumni = !!me.is_alumni;
  const [mine, setMine] = useState([]);
  const [testimonials, setTestimonials] = useState([]);
  const [ratingProgram, setRatingProgram] = useState(0);
  const [ratingPortal, setRatingPortal] = useState(0);
  const [body, setBody, clearBody] = useDraft(`feedback-draft-${me.id}`, "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function load() {
    const [{ data: m }, { data: t }] = await Promise.all([
      supabase.from("feedback").select("*").eq("user_id", me.id).order("created_at", { ascending: false }),
      supabase.from("public_testimonials").select("*").limit(30),
    ]);
    setMine(m || []);
    setTestimonials(t || []);
  }
  useEffect(() => { load(); }, [me.id]);

  const latest = mine[0];
  const canSubmit = isAlumni && (!latest || latest.status === "rejected");

  async function submit(e) {
    e.preventDefault();
    setErr(""); setOk("");
    if (!ratingProgram || !ratingPortal) return setErr("Please rate both the program and the portal.");
    if (!body.trim()) return setErr("Please write a short testimonial.");
    setBusy(true);
    const { error } = await supabase.from("feedback").insert({
      user_id: me.id, rating_program: ratingProgram, rating_portal: ratingPortal, body: body.trim(),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    clearBody(); setRatingProgram(0); setRatingPortal(0);
    setOk("Thanks! Your feedback was submitted and is pending review.");
    load();
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Feedback &amp; Ratings</h1>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-8 font-mono">
        {/* Submit / status */}
        {!isAlumni ? (
          <div className="bg-ink-900 border border-blood/20 rounded-sm p-6 text-sm text-neutral-400">
            Feedback opens once you complete the internship (Alumni). You can read what past interns said below.
          </div>
        ) : canSubmit ? (
          <form onSubmit={submit} className="bg-ink-900 border border-blood/20 rounded-sm p-6 space-y-5">
            <h2 className="text-sm uppercase tracking-widest text-white">Rate your experience</h2>
            {err && <p className="text-sm text-blood">{err}</p>}
            {ok && <p className="text-sm text-[#34d399]">{ok}</p>}
            <div className="flex flex-col sm:flex-row gap-6">
              <div>
                <p className="text-xs uppercase tracking-widest text-neutral-400 mb-1.5">Program</p>
                <Stars value={ratingProgram} onChange={setRatingProgram} />
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-neutral-400 mb-1.5">Portal</p>
                <Stars value={ratingPortal} onChange={setRatingPortal} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-widest text-neutral-400 mb-1.5">Your testimonial <span className="text-neutral-600 normal-case">(auto-saved as you type)</span></p>
              <textarea
                className="w-full bg-black border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm text-sm"
                rows={4} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder="What did you get out of the internship? Approved reviews may appear on our website."
              />
            </div>
            <button disabled={busy} className="bg-blood text-ink-950 font-bold uppercase tracking-widest text-xs px-6 py-3 rounded-sm hover:bg-blood-glow transition disabled:opacity-50">
              {busy ? "Submitting…" : "Submit feedback"}
            </button>
          </form>
        ) : (
          <div className="bg-ink-900 border border-blood/20 rounded-sm p-6 space-y-3">
            <h2 className="text-sm uppercase tracking-widest text-white">Your feedback</h2>
            <div className="flex gap-6">
              <div><p className="text-[11px] uppercase tracking-widest text-neutral-500 mb-1">Program</p><Stars value={latest.rating_program} readOnly size="text-lg" /></div>
              <div><p className="text-[11px] uppercase tracking-widest text-neutral-500 mb-1">Portal</p><Stars value={latest.rating_portal} readOnly size="text-lg" /></div>
            </div>
            <p className="text-sm text-neutral-300">“{latest.body}”</p>
            <p className="text-xs">Status: <span className={STATUS_STYLE[latest.status]}>{latest.status}</span></p>
          </div>
        )}

        {/* Approved testimonials */}
        <div>
          <h2 className="text-sm uppercase tracking-widest text-neutral-400 mb-3">What interns say</h2>
          {testimonials.length === 0 ? (
            <p className="text-sm text-neutral-500">No published testimonials yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {testimonials.map((t) => (
                <div key={t.id} className="bg-ink-900 border border-neutral-800 rounded-sm p-4">
                  <Stars value={Math.round((t.rating_program + t.rating_portal) / 2)} readOnly size="text-sm" />
                  <p className="text-sm text-neutral-300 mt-2">“{t.body}”</p>
                  <p className="text-[11px] text-neutral-500 mt-2">— {t.display_name}{t.domain ? `, ${t.domain}` : ""}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
