import ScrollyCanvas from "@/components/ScrollyCanvas";
import Overlay from "@/components/Overlay";
import Projects from "@/components/Projects";
import Experience from "@/components/Experience";
import Certifications from "@/components/Certifications";
import Education from "@/components/Education";
import Volunteering from "@/components/Volunteering";
import Contact from "@/components/Contact";

// Person structured data (Phase 13 — SEO). `sameAs` is left for the founder to fill (see
// docs/phases/PHASE-13-PORTFOLIO.md) — add LinkedIn/GitHub/X profile URLs when ready.
const personLd = {
  "@context": "https://schema.org",
  "@type": "Person",
  name: "Ali Raza",
  jobTitle: "Cybersecurity Professional & Ethical Hacking Instructor",
  worksFor: { "@type": "Organization", name: "ZeroDay Reapers", url: "https://zerodayreapers.me" },
  url: "https://zerodayreapers.me/portfolio",
};

export default function Home() {
  return (
    <main className="relative min-h-screen bg-[#050505] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(personLd) }} />

      {/* Route personal-brand traffic to the agency (Phase 13). UTM-tagged for analytics attribution. */}
      <a
        href="https://zerodayreapers.me/?utm_source=portfolio&utm_medium=referral&utm_campaign=portfolio_header"
        target="_blank"
        rel="noopener noreferrer"
        className="fixed top-4 right-4 z-30 font-mono text-[11px] uppercase tracking-widest border border-white/20 bg-black/30 text-white/80 px-3 py-2 rounded-sm backdrop-blur hover:border-[#e10600] hover:text-white transition"
      >
        ZeroDay Reapers ↗
      </a>

      {/* Ambient red glow + faint grid behind everything — matches the main site */}
      <div className="pointer-events-none fixed inset-0 z-0 zdr-grid opacity-40" />
      <div className="pointer-events-none fixed inset-0 z-0 zdr-ambience" />

      {/*
        This relative container holds the 500vh scrolly canvas
        and the parallax overlay sitting on top of it.
      */}
      <div className="relative z-10 w-full">
        <ScrollyCanvas />
        <Overlay />
      </div>

      {/*
        These sections flow normally in the document,
        appearing after the 500vh scroll completes.
        Transparent so the ambience shows through.
      */}
      <div className="relative z-10">
        <Projects />
        <Experience />
        <Certifications />
        <Education />
        <Volunteering />
        <Contact />
      </div>

    </main>
  );
}
