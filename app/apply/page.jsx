import Link from "next/link";
import WaitlistForm from "../_components/WaitlistForm";
import CohortCountdown from "../_components/CohortCountdown";

// Public Cohort 2 registration / apply page (Phase 12 — applicant funnel). Indexable and always reachable
// so the link can be shared; the form itself is gated by the `waitlist` flag (see WaitlistForm). Branded to
// match the marketing site (blood-on-ink, JetBrains Mono headings).
export const metadata = {
  title: "Cohort 2 Registration — ZeroDay Reapers Internship",
  description:
    "Register for Cohort 2 of the ZeroDay Reapers offensive-security internship. Hands-on tasks, real tooling, graded feedback, and a verifiable certificate. Starts October 1, 2026.",
  alternates: { canonical: "/apply" },
  openGraph: {
    title: "Cohort 2 Registration — ZeroDay Reapers",
    description: "Hands-on offensive-security internship. Cohort 2 begins October 1, 2026.",
    url: "/apply",
    type: "website",
  },
};

const COHORT_START = "2026-10-01T00:00:00+05:00"; // Oct 1, 2026, PKT
const COHORT_START_LABEL = "October 1, 2026";

const HIGHLIGHTS = [
  ["Weekly hands-on tasks", "Structured offensive-security challenges, one week at a time — no fluff, all practice."],
  ["Real tooling", "Work with the same tooling and workflows used on live engagements, in a safe lab environment."],
  ["Graded feedback", "Every submission is reviewed and graded by a mentor, so you know exactly where you stand."],
  ["Verifiable certificate", "Finish and earn a certificate anyone can validate on our public verification page."],
];

export default function ApplyPage() {
  return (
    <main className="relative min-h-screen bg-ink-950 text-neutral-200 overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 grid-bg opacity-30" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[55vh] red-glow" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-black/90 backdrop-blur border-b border-blood/20">
        <nav className="relative max-w-4xl mx-auto flex items-center justify-between px-6 py-3">
          <a href="/" className="flex items-center gap-3">
            <img src="/logo.svg" alt="ZeroDay Reapers" width={40} height={40} className="h-10 w-10" />
            <span className="font-mono text-sm tracking-widest text-white text-glow">
              ZERO<span className="text-blood">DAY</span> REAPERS
            </span>
          </a>
          <a
            href="/"
            className="font-mono text-xs uppercase tracking-widest text-neutral-400 hover:text-blood transition"
          >
            ← Back to site
          </a>
        </nav>
      </header>

      <article className="relative max-w-4xl mx-auto px-6 pt-16 pb-24">
        {/* Hero */}
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-4">
          // internship intake — cohort 02
        </div>
        <h1 className="font-mono text-4xl md:text-6xl font-bold text-white text-glow leading-[1.05]">
          Register for <span className="text-blood">Cohort 2</span>
        </h1>
        <p className="mt-6 text-neutral-400 leading-relaxed max-w-2xl text-lg">
          Hands-on offensive security: weekly tasks, real tooling, graded mentor feedback, and a verifiable
          certificate. Reserve your spot for the next cohort — kicking off{" "}
          <span className="text-neutral-200">{COHORT_START_LABEL}</span>.
        </p>

        <CohortCountdown target={COHORT_START} />

        {/* Program highlights */}
        <section className="mt-16 grid sm:grid-cols-2 gap-4">
          {HIGHLIGHTS.map(([title, desc]) => (
            <div key={title} className="border border-blood/15 bg-black/30 rounded-2xl p-6">
              <h2 className="font-mono text-sm uppercase tracking-widest text-white flex items-center gap-2">
                <span className="text-blood">▸</span>
                {title}
              </h2>
              <p className="mt-3 text-neutral-400 text-sm leading-relaxed">{desc}</p>
            </div>
          ))}
        </section>

        {/* Registration form */}
        <section className="mt-16">
          <h2 className="font-mono text-2xl md:text-3xl text-white">
            Reserve your <span className="text-blood">spot</span>
          </h2>
          <p className="mt-3 text-neutral-400 max-w-xl leading-relaxed">
            Add your details below. We&apos;ll email onboarding and start instructions before the cohort begins.
          </p>
          <WaitlistForm />
        </section>

        <p className="text-neutral-500 text-sm mt-14">
          Curious what alumni build?{" "}
          <Link href="/insights" className="text-blood hover:text-blood-glow transition">
            See our case studies &amp; outcomes
          </Link>.
        </p>
      </article>

      {/* Footer */}
      <footer className="border-t border-blood/10 bg-black">
        <div className="max-w-4xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4 font-mono text-xs text-neutral-500">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" width={24} height={24} className="h-6 w-6" />
            <span>© {new Date().getFullYear()} ZeroDay Reapers. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-6 uppercase tracking-widest">
            <a href="/" className="hover:text-blood transition">Home</a>
            <a href="/privacy" className="hover:text-blood transition">Privacy</a>
            <a href="/verify" className="hover:text-blood transition">Verify Certificate</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
