import Image from "next/image";
import CountdownTimer from "./_components/CountdownTimer";
import MobileNav from "./_components/MobileNav";
import Testimonials from "./_components/Testimonials";
import Proof from "./_components/Proof";

const SERVICES = [
  {
    code: "01",
    title: "Penetration Testing",
    desc: "Web app, network, and mobile pentests. Real exploitation, actionable reports, retest included.",
    bullets: ["OWASP Top 10 & beyond", "Internal / external network", "Mobile (Android / iOS)"],
  },
  {
    code: "02",
    title: "Vulnerability Assessment",
    desc: "Continuous scanning, prioritized remediation, and posture reviews mapped to your risk model.",
    bullets: ["Authenticated scans", "Risk-ranked findings", "Remediation guidance"],
  },
  {
    code: "03",
    title: "Red Team / Offensive Ops",
    desc: "Full-scope adversary simulation. Social engineering, physical, and digital — measure real detection.",
    bullets: ["Assumed-breach scenarios", "Phishing & OSINT", "Purple team debriefs"],
  },
  {
    code: "04",
    title: "Cloud Security",
    desc: "AWS, Azure, and GCP security reviews, misconfiguration audits, and cloud red team engagements.",
    bullets: ["IAM & privilege audits", "Container / K8s security", "Cloud attack paths"],
  },
  {
    code: "05",
    title: "Consulting & Compliance",
    desc: "Advisory for SOC 2, ISO 27001, and GDPR readiness. Program design, policy, and gap analysis.",
    bullets: ["SOC 2 / ISO 27001", "GDPR / privacy", "vCISO advisory"],
  },
  {
    code: "06",
    title: "Training & Mentorship",
    desc: "Ethical hacking training and mentored programs. CEH-aligned curriculum, hands-on labs.",
    bullets: ["CEH trainer-led", "Capstone projects", "Career mentorship"],
  },
];

const DEPARTMENTS = [
  { code: "01", name: "Offensive Security", tag: "Attack chains, exploitation, red team ops" },
  { code: "02", name: "Defensive Security", tag: "Detection engineering, SOC workflows, IR" },
  { code: "03", name: "Cloud Security", tag: "AWS · Azure · GCP hardening and audits" },
  { code: "04", name: "Governance & Compliance", tag: "SOC 2, ISO 27001, GDPR mapping" },
  { code: "05", name: "Digital Forensics", tag: "Disk, memory, and network artifact analysis" },
  { code: "06", name: "AI Security", tag: "LLM red teaming, model integrity, prompt attacks" },
];

const CERTS = [
  "Multi-Cloud Red Teaming Analyst",
  "Certified in Cybersecurity — Specialization",
  "eJPT",
  "PNPT",
  "CEH Trainer",
];

// Internships closed — application form link removed from the site. Restore this + its usages to reopen.
// const INTERN_FORM = "https://forms.gle/2Go27v2yRxcmTF9FA";
const EMAIL = "contact@zerodayreapers.me";
const DISCORD = "https://discord.gg/JATEvx9FED";
const GITHUB = "https://github.com/alee007-creator";
const LINKEDIN_FOUNDER = "https://www.linkedin.com/in/aliraza999/";
const LINKEDIN_COMPANY = "https://www.linkedin.com/company/134833925";

// WhatsApp — edit these links anytime. Community is the main invite; each group
// maps to one internship department. Replace the PLACEHOLDER urls with real ones.
const WHATSAPP_COMMUNITY = "https://chat.whatsapp.com/HjBaJYcIg466zgTvJbSMbr";
const WHATSAPP_GROUPS = [
  { dept: "Offensive Security", url: "https://chat.whatsapp.com/LBPvtqg5Lz4LMsn2hw9WTM" },
  { dept: "Defensive Security", url: "https://chat.whatsapp.com/G1B3SM6Ed5RA3LJyEky9MG" },
  { dept: "Cloud Security", url: "https://chat.whatsapp.com/Bt4KHUfCZJQILLvEjunfea" },
  { dept: "Governance & Compliance", url: "https://chat.whatsapp.com/IkOIT0PIybEHEJ9fO7eUut" },
  { dept: "Digital Forensics", url: "https://chat.whatsapp.com/IH6B1vYTze74pKE2YLVxpv" },
  { dept: "AI Security", url: "https://chat.whatsapp.com/KLXO6ABwVSFArL9S8ZKAqA" },
];

function WhatsAppIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.71.306 1.263.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

function DiscordIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.42 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.419-2.157 2.419zm7.975 0c-1.183 0-2.157-1.086-2.157-2.42 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.419-2.157 2.419z" />
    </svg>
  );
}

function GitHubIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

function LinkedInIcon({ className = "" }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
    </svg>
  );
}

export default function Page() {
  return (
    <main className="relative min-h-screen bg-ink-950 text-neutral-200 overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 grid-bg opacity-40" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[70vh] red-glow" />

      {/* Nav — pure black to blend with logo's black background */}
      <header className="sticky top-0 z-50 bg-black border-b border-blood/20">
        <nav className="relative max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <a href="#top" className="flex items-center gap-3">
            {/* ponytail: plain <img> for SVG — avoids next/image SVG config */}
            <img src="/logo.svg" alt="ZeroDay Reapers" width={44} height={44} className="h-11 w-11 animate-glow-pulse" />
            <span className="font-mono text-sm tracking-widest text-white text-glow">
              ZERO<span className="text-blood">DAY</span> REAPERS
            </span>
          </a>
          <ul className="hidden md:flex items-center gap-7 font-mono text-xs uppercase tracking-widest text-neutral-400">
            <li><a href="#services" className="hover:text-blood transition">Services</a></li>
            <li><a href="#internships" className="hover:text-blood transition">Internships</a></li>
            <li><a href="#whatsapp" className="hover:text-blood transition">Community</a></li>
            <li><a href="#about" className="hover:text-blood transition">About</a></li>
            <li><a href="#ceo" className="hover:text-blood transition">Team</a></li>
            <li><a href="#contact" className="hover:text-blood transition">Contact</a></li>
          </ul>
          <div className="hidden md:flex items-center gap-3">
            <a
              href="/portal"
              aria-label="Open the intern portal"
              className="group relative inline-flex items-center gap-2 overflow-hidden font-mono text-xs uppercase tracking-widest text-white px-5 py-2 rounded-lg bg-gradient-to-r from-[#b30500] via-blood to-[#ff1a1a] shadow-[0_0_20px_rgba(225,6,0,0.55)] hover:shadow-[0_0_34px_rgba(255,26,26,0.95)] hover:-translate-y-0.5 transition-all duration-200"
            >
              {/* shimmer sweep on hover */}
              <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 ease-out" />
              <svg className="relative h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                <polyline points="10 17 15 12 10 7" />
                <line x1="15" y1="12" x2="3" y2="12" />
              </svg>
              <span className="relative">Portal</span>
              <span aria-hidden className="relative transition-transform duration-200 group-hover:translate-x-0.5">↗</span>
            </a>
            <a
              href={WHATSAPP_COMMUNITY}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Join WhatsApp community"
              className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest border border-[#25D366]/60 text-[#25D366] px-4 py-2 rounded-sm hover:bg-[#25D366] hover:text-ink-950 hover:-translate-y-0.5 transition-all duration-200"
            >
              <WhatsAppIcon className="h-4 w-4" />
              WhatsApp
            </a>
            <a
              href={DISCORD}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest bg-blood text-ink-950 px-4 py-2 rounded-sm shadow-[0_0_20px_rgba(225,6,0,0.55)] hover:shadow-[0_0_32px_rgba(255,26,26,0.9)] hover:bg-blood-glow hover:-translate-y-0.5 transition-all duration-200"
            >
              <DiscordIcon className="h-4 w-4" />
              Discord
            </a>
          </div>
          <MobileNav whatsapp={WHATSAPP_COMMUNITY} discord={DISCORD} />
        </nav>
      </header>

      {/* Countdown sale-banner — directly under the nav */}
      <CountdownTimer />

      {/* Hero */}
      <section id="top" className="relative max-w-6xl mx-auto px-6 pt-24 pb-32">
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-6">
          &gt; offensive_security --live
        </div>
        <h1 className="font-mono text-5xl md:text-7xl font-bold leading-[1.05] text-white text-glow">
          We hunt the flaws<br />
          <span className="text-blood animate-flicker">before adversaries do.</span>
        </h1>
        <p className="mt-8 max-w-2xl text-lg text-neutral-400 leading-relaxed">
          ZeroDay Reapers is an offensive security collective delivering penetration testing,
          red team operations, cloud security, and hands-on cybersecurity training for
          organizations that refuse to be a case study.
        </p>
        <div className="mt-10 flex flex-wrap gap-4">
          <a
            href="#contact"
            className="font-mono text-sm uppercase tracking-widest bg-blood text-ink-950 px-6 py-3 hover:bg-blood-glow transition"
          >
            Request Engagement →
          </a>
          <a
            href="#internships"
            className="font-mono text-sm uppercase tracking-widest border border-neutral-700 text-neutral-300 px-6 py-3 hover:border-blood hover:text-blood transition"
          >
            Apply for Internship
          </a>
        </div>

        <div className="mt-24 grid grid-cols-2 md:grid-cols-4 gap-8 border-t border-blood/10 pt-10">
          {[
            ["100+", "Students trained"],
            ["6", "Intern departments"],
            ["3", "Cloud platforms"],
            ["0-day", "Mindset"],
          ].map(([k, v]) => (
            <div key={k}>
              <div className="font-mono text-3xl text-blood">{k}</div>
              <div className="font-mono text-xs uppercase tracking-widest text-neutral-500 mt-1">{v}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Services */}
      <section id="services" className="relative max-w-6xl mx-auto px-6 py-24 border-t border-blood/10">
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-4">// services</div>
        <h2 className="font-mono text-3xl md:text-5xl text-white mb-16 max-w-3xl">
          What we do when the perimeter falls.
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-blood/20">
          {SERVICES.map((s) => (
            <article
              key={s.code}
              className="group bg-ink-950 p-8 hover:bg-ink-900 transition relative overflow-hidden"
            >
              <div className="absolute top-0 right-0 font-mono text-6xl text-blood/10 group-hover:text-blood/30 transition p-4">
                {s.code}
              </div>
              <h3 className="font-mono text-xl text-white mb-3">{s.title}</h3>
              <p className="text-neutral-400 mb-6 text-sm leading-relaxed">{s.desc}</p>
              <ul className="space-y-1 font-mono text-xs text-neutral-500">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-blood">▸</span> {b}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      {/* Internships */}
      <section id="internships" className="relative max-w-6xl mx-auto px-6 py-24 border-t border-blood/10">
        <div className="mb-14 max-w-3xl">
          <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-4">// internships — closed</div>
          <h2 className="font-mono text-3xl md:text-5xl text-white leading-tight">
            6 weeks. 6 tasks. <br />
            <span className="text-blood">One certificate.</span>
          </h2>
          <p className="mt-6 text-neutral-400 leading-relaxed">
            A remote, unpaid internship built around <span className="text-white">six practical, real-world
            scenarios</span> — the kind you&apos;ll actually face in the field. Complete all six on
            schedule and you&apos;ll receive an internship completion certificate from
            ZeroDay Reapers.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 font-mono text-xs">
            {["6 weeks", "Remote", "Unpaid", "6 practical tasks", "Certificate on completion"].map((t) => (
              <span key={t} className="border border-blood/40 text-neutral-200 px-3 py-1.5">
                {t}
              </span>
            ))}
          </div>
          <div className="mt-8">
            <span className="inline-block font-mono text-sm uppercase tracking-widest border border-neutral-700 text-neutral-500 px-6 py-3">
              🔒 Applications closed
            </span>
          </div>
        </div>

        <div className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-500 mb-4">
          Departments
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-blood/20">
          {DEPARTMENTS.map((d) => (
            <div key={d.code} className="bg-ink-950 p-6 hover:bg-ink-900 transition relative">
              <div className="absolute top-4 right-4 font-mono text-xs text-blood/50">{d.code}</div>
              <div className="font-mono text-lg text-white">{d.name}</div>
              <div className="mt-2 text-sm text-neutral-500">{d.tag}</div>
            </div>
          ))}
        </div>
      </section>

      {/* WhatsApp community + department groups */}
      <section id="whatsapp" className="relative max-w-6xl mx-auto px-6 py-24 border-t border-blood/10">
        <div className="grid md:grid-cols-[1fr_320px] gap-12 items-start mb-14">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.4em] text-[#25D366] mb-4">// whatsapp — join us</div>
            <h2 className="font-mono text-3xl md:text-5xl text-white leading-tight">
              Join the <span className="text-[#25D366]">community.</span>
            </h2>
            <p className="mt-6 text-neutral-400 leading-relaxed">
              Anyone can join the main community for announcements, resources, and support.
              Department groups are only for applicants accepted into that field — requests
              to a group you didn&apos;t apply for will be discarded.
            </p>
          </div>
          <div className="flex md:justify-end items-start">
            <a
              href={WHATSAPP_COMMUNITY}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 font-mono text-sm uppercase tracking-widest bg-[#25D366] text-ink-950 px-6 py-3 rounded-sm shadow-[0_0_24px_rgba(37,211,102,0.5)] hover:shadow-[0_0_40px_rgba(37,211,102,0.85)] hover:-translate-y-0.5 transition-all duration-200"
            >
              <WhatsAppIcon className="h-5 w-5" />
              Join Community
            </a>
          </div>
        </div>

        {/* Department group invites hidden while internships are closed — uncomment to restore.
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-500 mb-4">
          Department Groups
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[#25D366]/20">
          {WHATSAPP_GROUPS.map((g) => (
            <a
              key={g.dept}
              href={g.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group bg-ink-950 p-6 hover:bg-ink-900 transition flex items-center justify-between gap-4"
            >
              <span className="font-mono text-lg text-white">{g.dept}</span>
              <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-[#25D366] group-hover:translate-x-0.5 transition-transform">
                <WhatsAppIcon className="h-4 w-4" />
                Join
              </span>
            </a>
          ))}
        </div>
        */}
      </section>

      {/* About */}
      <section id="about" className="relative max-w-6xl mx-auto px-6 py-24 border-t border-blood/10">
        <div className="grid md:grid-cols-2 gap-16 items-start">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-4">// about</div>
            <h2 className="font-mono text-3xl md:text-5xl text-white leading-tight">
              Adversary-first. <br />
              <span className="text-blood">Report-driven.</span>
            </h2>
          </div>
          <div className="space-y-6 text-neutral-400 leading-relaxed">
            <p>
              ZeroDay Reapers is built on the conviction that defense without an offensive
              worldview is theatre. We think like the people trying to breach you — because
              we&apos;ve spent our careers doing exactly that, ethically, for clients across
              cloud, enterprise, and startups.
            </p>
            <p>
              Every engagement ships a report an engineer can act on and an executive can
              understand. No boilerplate scanners dumped over the fence. No fluff.
            </p>
            <div className="grid grid-cols-2 gap-4 pt-4 font-mono text-xs uppercase tracking-widest">
              <div className="border border-blood/30 p-4">
                <div className="text-blood text-2xl">01</div>
                <div className="mt-2 text-neutral-300">Scope with clarity</div>
              </div>
              <div className="border border-blood/30 p-4">
                <div className="text-blood text-2xl">02</div>
                <div className="mt-2 text-neutral-300">Exploit with intent</div>
              </div>
              <div className="border border-blood/30 p-4">
                <div className="text-blood text-2xl">03</div>
                <div className="mt-2 text-neutral-300">Report with rigor</div>
              </div>
              <div className="border border-blood/30 p-4">
                <div className="text-blood text-2xl">04</div>
                <div className="mt-2 text-neutral-300">Retest until fixed</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CEO */}
      <Proof />

      <section id="ceo" className="relative max-w-6xl mx-auto px-6 py-24 border-t border-blood/10">
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-4">// leadership</div>
        <h2 className="font-mono text-3xl md:text-5xl text-white mb-16">The Reaper-in-Chief.</h2>

        <div className="grid md:grid-cols-[320px_1fr] gap-12 items-start">
          <div className="relative">
            <div className="aspect-[4/5] border border-blood/30 relative overflow-hidden">
              <Image
                src="/ali.jpg"
                alt="Ali Raza — CEO / Founder, ZeroDay Reapers"
                fill
                sizes="(max-width: 768px) 100vw, 320px"
                className="object-cover"
                priority
              />
              <div className="absolute bottom-0 inset-x-0 bg-blood text-ink-950 font-mono text-xs uppercase tracking-widest px-3 py-2">
                CEO / Founder
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-mono text-3xl text-white">Ali Raza</h3>
            <p className="mt-2 text-blood font-mono text-sm">
              Cybersecurity Professional &amp; Ethical Hacking Instructor
            </p>
            <p className="mt-6 text-neutral-400 leading-relaxed">
              Ali has trained <span className="text-white">100+ students</span> in offensive
              security and helps organizations harden their posture through penetration
              testing, red teaming, and cloud security engagements across AWS, Azure, and
              GCP. As a CEH trainer, he blends field-tested tradecraft with a curriculum
              designed for people who want to actually break — and then defend — systems.
            </p>

            <div className="mt-8">
              <div className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-500 mb-3">
                Certifications
              </div>
              <div className="flex flex-wrap gap-2">
                {CERTS.map((c) => (
                  <span
                    key={c}
                    className="font-mono text-xs border border-blood/40 text-neutral-200 px-3 py-1.5 hover:bg-blood hover:text-ink-950 transition"
                  >
                    {c}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href="/portfolio"
                className="font-mono text-xs uppercase tracking-widest bg-blood text-ink-950 px-4 py-2 shadow-[0_0_20px_rgba(225,6,0,0.55)] hover:bg-blood-glow hover:shadow-[0_0_32px_rgba(255,26,26,0.9)] transition-all"
              >
                View Full Portfolio →
              </a>
              <a
                href={LINKEDIN_FOUNDER}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 hover:border-blood hover:text-blood transition"
              >
                <LinkedInIcon className="h-4 w-4" />
                LinkedIn ↗
              </a>
              <a
                href={GITHUB}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 hover:border-blood hover:text-blood transition"
              >
                <GitHubIcon className="h-4 w-4" />
                GitHub ↗
              </a>
            </div>
          </div>
        </div>

      </section>

      {/* Contact */}
      <Testimonials />

      <section id="contact" className="relative max-w-6xl mx-auto px-6 py-24 border-t border-blood/10">
        <div className="grid md:grid-cols-2 gap-16">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-4">// contact</div>
            <h2 className="font-mono text-3xl md:text-5xl text-white leading-tight">
              Start the <span className="text-blood">engagement.</span>
            </h2>
            <p className="mt-6 text-neutral-400 leading-relaxed max-w-md">
              Tell us the scope, the timeline, and the outcome you need. We reply within one
              business day with a scoping call.
            </p>
            <div className="mt-10 font-mono text-sm space-y-3 text-neutral-400">
              <div>
                <span className="text-neutral-600">email &gt;</span>{" "}
                <a href={`mailto:${EMAIL}`} className="text-neutral-200 hover:text-blood break-all">
                  {EMAIL}
                </a>
              </div>
              <div>
                <span className="text-neutral-600">internship &gt;</span>{" "}
                <span className="text-neutral-500">Applications closed</span>
              </div>
              <div>
                <span className="text-neutral-600">discord &gt;</span>{" "}
                <a
                  href={DISCORD}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-200 hover:text-blood"
                >
                  discord.gg/JATEvx9FED ↗
                </a>
              </div>
              <div>
                <span className="text-neutral-600">whatsapp &gt;</span>{" "}
                <a
                  href={WHATSAPP_COMMUNITY}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-200 hover:text-[#25D366]"
                >
                  Join community ↗
                </a>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap gap-4">
              <a
                href={WHATSAPP_COMMUNITY}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 font-mono text-sm uppercase tracking-widest bg-[#25D366] text-ink-950 px-6 py-3 rounded-sm shadow-[0_0_24px_rgba(37,211,102,0.5)] hover:shadow-[0_0_40px_rgba(37,211,102,0.85)] hover:-translate-y-0.5 transition-all duration-200"
              >
                <WhatsAppIcon className="h-5 w-5" />
                WhatsApp
              </a>
              <a
                href={DISCORD}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 font-mono text-sm uppercase tracking-widest bg-blood text-ink-950 px-6 py-3 rounded-sm shadow-[0_0_24px_rgba(225,6,0,0.6)] hover:shadow-[0_0_40px_rgba(255,26,26,0.95)] hover:bg-blood-glow hover:-translate-y-0.5 transition-all duration-200"
              >
                <DiscordIcon className="h-5 w-5" />
                Discord
              </a>
            </div>
          </div>

          <form
            action="https://api.web3forms.com/submit"
            method="POST"
            className="space-y-4 font-mono text-sm"
          >
            {/* ponytail: paste your Web3Forms access key from https://web3forms.com (free) */}
            <input type="hidden" name="access_key" value="2414feca-4010-4bc9-ae03-e7678397cc08" />
            <input type="hidden" name="subject" value="New ZeroDay Reapers inquiry" />
            <input type="hidden" name="from_name" value="ZeroDay Reapers Website" />
            <input type="checkbox" name="botcheck" className="hidden" />

            <Field label="Name" name="name" required />
            <Field label="Email" name="email" type="email" required />
            <Field label="Company" name="company" />
            <div>
              <label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">
                Scope / message *
              </label>
              <textarea
                name="message"
                required
                rows={5}
                className="w-full bg-ink-900 border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 resize-none"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blood text-ink-950 uppercase tracking-widest py-3 hover:bg-blood-glow transition"
            >
              Transmit →
            </button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-blood/10 mt-16 bg-black">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-6 font-mono text-xs text-neutral-500">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="" width={28} height={28} className="h-7 w-7" />
            <span>© {new Date().getFullYear()} ZeroDay Reapers. All rights reserved.</span>
          </div>

          {/* Social / company presence — signals an active, genuine organisation */}
          <div className="flex items-center gap-4">
            <a
              href={LINKEDIN_COMPANY}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="ZeroDay Reapers on LinkedIn"
              className="text-neutral-500 hover:text-[#0A66C2] hover:-translate-y-0.5 transition-all duration-200"
            >
              <LinkedInIcon className="h-5 w-5" />
            </a>
            <a
              href={GITHUB}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="ZeroDay Reapers on GitHub"
              className="text-neutral-500 hover:text-white hover:-translate-y-0.5 transition-all duration-200"
            >
              <GitHubIcon className="h-5 w-5" />
            </a>
            <a
              href={DISCORD}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Join our Discord"
              className="text-neutral-500 hover:text-[#5865F2] hover:-translate-y-0.5 transition-all duration-200"
            >
              <DiscordIcon className="h-5 w-5" />
            </a>
            <a
              href={WHATSAPP_COMMUNITY}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Join our WhatsApp community"
              className="text-neutral-500 hover:text-[#25D366] hover:-translate-y-0.5 transition-all duration-200"
            >
              <WhatsAppIcon className="h-5 w-5" />
            </a>
          </div>

          <div className="flex items-center gap-6 uppercase tracking-widest">
            <a href="/verify" className="hover:text-blood transition">Verify Certificate</a>
            <span><span className="text-blood">●</span> systems nominal</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Field({ label, name, type = "text", required = false }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-widest text-neutral-500 mb-2">
        {label} {required && "*"}
      </label>
      <input
        type={type}
        name={name}
        required={required}
        className="w-full bg-ink-900 border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100"
      />
    </div>
  );
}
