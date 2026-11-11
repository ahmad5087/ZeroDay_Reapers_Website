"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

// Public Best-Intern Hall of Fame (client). Cards are grouped by domain; clicking one opens a modal
// with that intern's snapshotted Skill Passport (fetched by id via the anon get_hall_of_fame_passport
// RPC). No email is shown — LinkedIn only. Data comes from the server page via props.

const RED = "#e10600";

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}

function Avatar({ src, name, size = 88 }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="rounded-full object-cover border-2 border-blood/40"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      className="rounded-full grid place-items-center border-2 border-blood/40 bg-ink-900 text-blood font-mono font-bold"
      style={{ width: size, height: size, fontSize: size * 0.34 }}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}

function LinkedInIcon({ className = "" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

const levelColor = (lvl) => (lvl === "Advanced" ? "#34d399" : lvl === "Proficient" ? "#eab308" : "#9a9a9a");

function PassportModal({ card, onClose }) {
  const p = card.passport;
  const skills = Array.isArray(p?.skills) ? p.skills : [];
  const axes = Array.isArray(p?.axes) ? p.axes : [];
  const tasks = Array.isArray(p?.tasks) ? p.tasks : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg my-auto glass glass-red cyber-corners p-6 sm:p-7 font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-4">
          <Avatar src={card.photo_url || card.avatar_url} name={card.name} size={64} />
          <div className="min-w-0 flex-1">
            <h3 className="text-white text-lg leading-tight break-words">{card.name}</h3>
            <p className="text-blood text-xs uppercase tracking-widest mt-0.5">{card.domain}</p>
            <p className="text-neutral-500 text-[11px] mt-0.5">
              {card.cohort ? `Cohort ${card.cohort}` : ""}{card.year ? ` · ${card.year}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-blood text-sm shrink-0">✕</button>
        </div>

        {!p ? (
          <p className="mt-6 text-neutral-500 text-sm">Skill passport isn&apos;t available for this intern.</p>
        ) : (
          <div className="mt-6 space-y-5">
            <div className="flex items-baseline gap-3">
              <span className="text-4xl font-bold text-white">{p.overall_pct == null ? "—" : p.overall_pct + "%"}</span>
              <span className="text-[11px] uppercase tracking-widest text-neutral-500">
                overall · {p.count || 0} approved deliverable{p.count === 1 ? "" : "s"}
              </span>
              <span className="ml-auto text-[10px] uppercase tracking-widest text-[#34d399] border border-[#34d399]/40 rounded-full px-2 py-0.5">✓ Verified</span>
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-widest text-neutral-500 mb-2">Skills &amp; grip</div>
              {skills.length === 0 ? (
                <p className="text-neutral-600 text-sm">No graded work recorded.</p>
              ) : (
                <div className="space-y-3">
                  {skills.map((s, i) => (
                    <div key={i}>
                      <div className="flex justify-between items-baseline gap-2 text-xs mb-1">
                        <span className="text-neutral-200 font-semibold">
                          {s.skill} <span className="text-neutral-600 font-normal">· {s.tasks} task{s.tasks === 1 ? "" : "s"}</span>
                        </span>
                        <span className="font-bold" style={{ color: levelColor(s.level) }}>
                          {s.level}{s.pct != null ? ` · ${s.pct}%` : ""}
                        </span>
                      </div>
                      <div className="h-2 rounded bg-ink-900 overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${s.pct || 0}%`, background: `linear-gradient(90deg, ${RED}, #ff6a63)` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {axes.some((a) => a.value != null) && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-neutral-500 mb-2">Competencies</div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {axes.map((a, i) => (
                    <div key={i} className="border border-blood/20 rounded-sm px-3 py-2">
                      <div className="text-[10px] text-neutral-500">{a.label}</div>
                      <div className="text-white font-bold">{a.value == null ? "—" : `${a.value}/10`}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tasks.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-widest text-neutral-500 mb-2">Passport booklet</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {tasks.map((t, i) => (
                    <div key={i} className="border border-dashed border-blood/40 rounded-sm px-3 py-2 relative">
                      <div className="text-[10px] text-neutral-500">Week {t.week}</div>
                      <div className="text-xs text-neutral-200 font-semibold leading-tight mt-0.5 mb-1">{t.title}</div>
                      <div className="text-[11px] text-neutral-500">{t.score == null ? "—" : `${t.score} / ${t.week === 6 ? 100 : 40}`}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-neutral-600 text-[11px] border-t border-blood/10 pt-3">
              Generated from graded internship work · ZeroDay Reapers Skill Passport
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HallOfFame({ domains = [], inductees = [] }) {
  const [active, setActive] = useState(null); // { ...card, passport }
  const [loadingId, setLoadingId] = useState(null);

  async function openCard(card) {
    if (!card.has_passport) { setActive({ ...card, passport: null }); return; }
    setLoadingId(card.id);
    try {
      const { data } = await supabase.rpc("get_hall_of_fame_passport", { p_id: card.id });
      setActive({ ...card, passport: data || null });
    } catch {
      setActive({ ...card, passport: null });
    } finally {
      setLoadingId(null);
    }
  }

  // Group by domain, preserving the admin domain order; append any unknown-domain inductees last.
  const groups = domains
    .map((d) => ({ id: d.id, name: d.name, people: inductees.filter((i) => i.domain_id === d.id) }))
    .filter((g) => g.people.length > 0);
  const known = new Set(domains.map((d) => d.id));
  const orphans = inductees.filter((i) => !known.has(i.domain_id));
  if (orphans.length) groups.push({ id: "other", name: "Other", people: orphans });

  return (
    <main className="min-h-screen bg-black text-neutral-200">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-black/80 backdrop-blur border-b border-blood/20">
        <nav className="max-w-6xl mx-auto flex items-center justify-between px-4 sm:px-6 py-3">
          <a href="/" className="flex items-center gap-3">
            <img src="/logo.svg" alt="ZeroDay Reapers" width={40} height={40} className="h-10 w-10" />
            <span className="font-mono text-sm tracking-widest text-white">
              ZERO<span className="text-blood">DAY</span> REAPERS
            </span>
          </a>
          <a href="/" className="font-mono text-xs uppercase tracking-widest text-neutral-400 hover:text-blood transition">← Back to site</a>
        </nav>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 pb-8 text-center">
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-4">// hall of fame</div>
        <h1 className="font-mono text-3xl sm:text-5xl text-white leading-tight">
          Best <span className="text-blood">Interns</span>
        </h1>
        <p className="mt-5 text-neutral-400 leading-relaxed max-w-xl mx-auto">
          The standout interns of every ZeroDay Reapers cohort, by domain. Click anyone to see their
          verified Skill Passport — built from their graded internship work.
        </p>
      </section>

      {/* Wall */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-24">
        {groups.length === 0 ? (
          <div className="border border-blood/20 rounded-2xl bg-black/40 p-10 text-center font-mono text-sm text-neutral-500">
            The first inductees are being selected — check back soon.
          </div>
        ) : (
          <div className="space-y-14">
            {groups.map((g) => (
              <div key={g.id}>
                <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-500 border-b border-blood/15 pb-3 mb-6">
                  {g.name} <span className="text-neutral-700">· {g.people.length}</span>
                </h2>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {g.people.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => openCard(c)}
                      className="group text-left border border-blood/20 rounded-2xl bg-black/40 p-6 hover:border-blood/60 hover:-translate-y-0.5 transition-all"
                    >
                      <div className="flex items-center gap-4">
                        <Avatar src={c.photo_url || c.avatar_url} name={c.name} size={72} />
                        <div className="min-w-0 flex-1">
                          <div className="font-mono text-white text-base leading-tight break-words group-hover:text-blood transition">{c.name}</div>
                          <div className="font-mono text-[11px] uppercase tracking-widest text-blood mt-1">{c.domain}</div>
                          {c.cohort ? <div className="font-mono text-[10px] text-neutral-500 mt-0.5">Cohort {c.cohort}{c.year ? ` · ${c.year}` : ""}</div> : null}
                        </div>
                      </div>
                      <div className="mt-5 flex items-center gap-3">
                        {c.linkedin_url ? (
                          <a
                            href={c.linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-[#0A66C2] hover:text-[#0A66C2] transition"
                          >
                            <LinkedInIcon className="h-3.5 w-3.5" /> LinkedIn
                          </a>
                        ) : <span />}
                        <span className="ml-auto font-mono text-[11px] uppercase tracking-widest text-neutral-500 group-hover:text-blood transition">
                          {loadingId === c.id ? "…" : "Passport →"}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {active && <PassportModal card={active} onClose={() => setActive(null)} />}
    </main>
  );
}
