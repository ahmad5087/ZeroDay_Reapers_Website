"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Public testimonials on the marketing homepage. Reads admin-approved feedback via the
// `public_testimonials` view (anon-readable). Renders nothing until there are approved reviews,
// so the homepage never shows an empty block.
export default function Testimonials() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("public_testimonials").select("*").limit(9).then(({ data }) => setItems(data || []));
  }, []);

  if (!items.length) return null;

  const stars = (t) => {
    const n = Math.max(1, Math.round((t.rating_program + t.rating_portal) / 2));
    return "★".repeat(n) + "☆".repeat(5 - n);
  };

  return (
    <section id="testimonials" className="relative max-w-6xl mx-auto px-6 py-24 border-t border-blood/10">
      <h2 className="font-mono text-2xl md:text-3xl text-white mb-2">What our interns say</h2>
      <p className="font-mono text-sm text-neutral-500 mb-10">Real reviews from ZeroDay Reapers interns.</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {items.map((t) => (
          <div key={t.id} className="border border-blood/20 bg-black/40 rounded-sm p-6">
            <div className="text-amber-400 text-sm mb-3 tracking-widest">{stars(t)}</div>
            <p className="text-sm text-neutral-300 leading-relaxed">“{t.body}”</p>
            <p className="font-mono text-xs text-neutral-500 mt-4">— {t.display_name}{t.domain ? `, ${t.domain}` : ""}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
