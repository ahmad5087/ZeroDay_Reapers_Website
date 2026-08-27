// Privacy Policy (Phase 17 — quality/GDPR). Public legal page, matches the marketing-site design.
// Content is tailored to the app's real data flows (Supabase, Cloudflare R2/Turnstile, Resend, Discord,
// Vercel, Google AdSense, Sentry) and the self-serve export / admin-mediated deletion model.

export const metadata = {
  title: "Privacy Policy — ZeroDay Reapers",
  description:
    "How ZeroDay Reapers (SMC-Private) Limited collects, uses, shares, and protects your personal data — and how to exercise your privacy rights, including data export and deletion.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

const EMAIL = "contact@zerodayreapers.me";
const EFFECTIVE = "1 August 2026";
const COMPANY = "ZERODAY REAPERS (SMC-PRIVATE) LIMITED";

const PROCESSORS = [
  ["Supabase", "Database, authentication, and realtime — stores your account, submissions, and activity."],
  ["Cloudflare", "CDN, WAF/DDoS protection, Turnstile (bot check), and R2 object storage for files you upload."],
  ["Resend", "Transactional and (optional) digest email delivery."],
  ["Discord", "Optional sign-in/community linking if you connect a Discord account."],
  ["Vercel", "Website and application hosting, plus cookieless web analytics."],
  ["Google AdSense", "Advertising on public pages (publisher ID ca-pub-4661416076527631); may set advertising cookies."],
  ["Sentry", "Error and performance monitoring to keep the service reliable; may process technical/diagnostic data."],
];

function Section({ n, title, children }) {
  return (
    <section className="border-t border-blood/10 py-10">
      <h2 className="font-mono text-xl md:text-2xl text-white flex items-baseline gap-3">
        <span className="text-blood text-sm">{n}</span>
        {title}
      </h2>
      <div className="mt-5 space-y-4 text-neutral-400 leading-relaxed text-[15px]">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <main className="relative min-h-screen bg-ink-950 text-neutral-200 overflow-x-hidden">
      <div className="pointer-events-none fixed inset-0 grid-bg opacity-30" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[50vh] red-glow" />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-black border-b border-blood/20">
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
        {/* Title block */}
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-4">// legal — privacy</div>
        <h1 className="font-mono text-4xl md:text-6xl font-bold text-white text-glow leading-[1.05]">
          Privacy Policy
        </h1>
        <p className="mt-6 font-mono text-xs uppercase tracking-widest text-neutral-500">
          Effective {EFFECTIVE} · {COMPANY}
        </p>
        <p className="mt-8 text-neutral-400 leading-relaxed max-w-2xl">
          This policy explains what personal data {COMPANY} (&quot;ZeroDay Reapers&quot;, &quot;we&quot;,
          &quot;us&quot;) collects through <span className="text-neutral-200">zerodayreapers.me</span> and the
          ZeroDay Reapers intern portal, how we use and share it, and the rights you have — including the
          ability to <span className="text-neutral-200">download your data</span> and request deletion.
        </p>

        <Section n="1." title="Who we are & scope">
          <p>
            We are <span className="text-neutral-200">{COMPANY}</span>, a company registered in Pakistan
            (SMC-Private Limited), operated by Ali Raza. You can reach us about any privacy matter at{" "}
            <a href={`mailto:${EMAIL}`} className="text-blood hover:text-blood-glow break-all">{EMAIL}</a>.
          </p>
          <p>
            This policy governs the ZeroDay Reapers website and portal. Our services are offered to users
            internationally, except where prohibited by law — we do not offer the service to users located in
            Israel. This policy is governed by the laws of Pakistan, without prejudice to any mandatory data-
            protection rights you have under your local law (see Section 9).
          </p>
        </Section>

        <Section n="2." title="Information we collect">
          <p>We collect the following categories of personal data:</p>
          <ul className="space-y-3">
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-1">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Account &amp; profile</span> — email address,
                name, display name, country and phone number, member ID, department, role, an optional avatar,
                and any LinkedIn/GitHub links you choose to add.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-1">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Program activity</span> — task submissions and
                files you upload, grades and feedback, milestones, and in-portal messages and direct messages
                you send.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-1">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Security &amp; sign-in data</span> — IP
                address, approximate location, device/browser details, and sign-in times. We use this to send
                new-device / new-location sign-in alerts and to prevent abuse.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-1">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Communications</span> — messages you send us and
                information you submit through our contact or inquiry forms.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-1">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Technical &amp; cookies</span> — see Section 5.
              </span>
            </li>
          </ul>
        </Section>

        <Section n="3." title="How we use your information">
          <p>We use personal data to:</p>
          <ul className="space-y-2">
            {[
              "Provide and operate the website, portal, internships, and training;",
              "Create and secure your account and authenticate sign-ins;",
              "Grade submissions and issue completion certificates;",
              "Send transactional emails and, where enabled, an optional weekly digest;",
              "Protect the service — detecting, preventing, and investigating abuse or security incidents;",
              "Measure and improve performance and reliability; and",
              "Comply with legal obligations.",
            ].map((t) => (
              <li key={t} className="flex gap-3">
                <span className="text-blood font-mono mt-0.5">▸</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section n="4." title="Legal bases (EEA / UK users)">
          <p>
            If you are in the European Economic Area or the United Kingdom, we process your data on these
            bases: <span className="text-neutral-200">performance of a contract</span> (to provide the portal
            and internship), <span className="text-neutral-200">legitimate interests</span> (security, abuse
            prevention, and improving the service), <span className="text-neutral-200">consent</span> (for
            advertising cookies and any optional marketing), and{" "}
            <span className="text-neutral-200">legal obligation</span> where the law requires it.
          </p>
        </Section>

        <Section n="5." title="Cookies & advertising">
          <p>We use a small number of cookies and similar technologies:</p>
          <ul className="space-y-2">
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-0.5">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Essential</span> — required to keep you signed in
                and to run core features. These cannot be turned off.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-0.5">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Analytics</span> — we use Vercel Web Analytics,
                which is <span className="text-neutral-200">cookieless</span> and does not track you across
                sites.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-0.5">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Advertising</span> — public pages may show ads
                via Google AdSense (publisher ID <span className="font-mono text-neutral-300">ca-pub-4661416076527631</span>).
                Google and its partners may set cookies to serve and personalize ads and measure their
                performance. You can manage or opt out of personalized ads at{" "}
                <a href="https://myadcenter.google.com/" target="_blank" rel="noopener noreferrer" className="text-blood hover:text-blood-glow">Google Ad Center</a>{" "}
                and{" "}
                <a href="https://optout.aboutads.info/" target="_blank" rel="noopener noreferrer" className="text-blood hover:text-blood-glow">optout.aboutads.info</a>.
              </span>
            </li>
          </ul>
          <p>You can also block or delete cookies through your browser settings.</p>
        </Section>

        <Section n="6." title="Service providers we share data with">
          <p>
            We do not sell your personal data. We share it only with the service providers (processors) that
            help us run ZeroDay Reapers, under agreements that require them to protect it:
          </p>
          <dl className="mt-2 divide-y divide-blood/10 border border-blood/20">
            {PROCESSORS.map(([name, desc]) => (
              <div key={name} className="grid sm:grid-cols-[160px_1fr] gap-2 sm:gap-4 px-4 py-3">
                <dt className="font-mono text-sm text-neutral-200">{name}</dt>
                <dd className="text-sm text-neutral-400">{desc}</dd>
              </div>
            ))}
          </dl>
          <p>
            We may also disclose data where required by law, to enforce our terms, or to protect the rights and
            safety of our users and the public.
          </p>
        </Section>

        <Section n="7." title="International data transfers">
          <p>
            We operate internationally, and our providers process data in various countries. When we transfer
            personal data across borders, we rely on appropriate safeguards and the protections offered by
            these providers. By using the service, you understand your data may be processed outside your
            country of residence.
          </p>
        </Section>

        <Section n="8." title="How long we keep your data">
          <p>
            We keep your personal data while your account is active and for as long as needed to provide the
            service and meet legal, security, and accounting requirements. When an account is deleted, we
            remove your personal data, except a minimal set of records we must retain — for example, markers
            used to enforce bans and prevent abuse, and records relating to certificates already issued.
          </p>
        </Section>

        <Section n="9." title="Your rights & choices">
          <p>Subject to your local law, you have the right to:</p>
          <ul className="space-y-2">
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-0.5">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Access &amp; portability</span> — signed-in
                users can download their data (profile, submissions, activity, feedback, and messages) at any
                time from the portal dashboard using <span className="text-neutral-200">&quot;Download my data&quot;</span>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-0.5">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Deletion</span> — request deletion of your
                account by emailing{" "}
                <a href={`mailto:${EMAIL}`} className="text-blood hover:text-blood-glow break-all">{EMAIL}</a>.
                We process deletions manually to honour the retention rules in Section 8.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="text-blood font-mono mt-0.5">▸</span>
              <span>
                <span className="text-neutral-200 font-medium">Correction, restriction, objection</span>, and{" "}
                <span className="text-neutral-200 font-medium">withdrawal of consent</span> at any time.
              </span>
            </li>
          </ul>
          <p>
            <span className="text-neutral-200">EEA/UK residents</span> may lodge a complaint with their local
            data-protection supervisory authority. <span className="text-neutral-200">California residents</span>{" "}
            have the right to know, delete, and opt out of the &quot;sale&quot; or &quot;sharing&quot; of
            personal information (we do not sell your data), without discrimination for exercising these
            rights. To exercise any right, email{" "}
            <a href={`mailto:${EMAIL}`} className="text-blood hover:text-blood-glow break-all">{EMAIL}</a>.
          </p>
        </Section>

        <Section n="10." title="How we protect your data">
          <p>
            We use HTTPS everywhere (with HSTS), encrypt data in transit and keep encrypted backups, enforce
            row-level security on the database, require two-factor authentication for administrators, and offer
            optional passkey (WebAuthn) sign-in. No system is perfectly secure, but we work continuously to
            protect your information and respond to incidents.
          </p>
        </Section>

        <Section n="11." title="Children">
          <p>
            The service is not directed to children under 16, and we do not knowingly collect their personal
            data. If you believe a child has provided us data, contact us and we will delete it.
          </p>
        </Section>

        <Section n="12." title="Changes to this policy">
          <p>
            We may update this policy from time to time. When we do, we will revise the effective date above,
            and for material changes we will provide a more prominent notice. Your continued use of the service
            after an update means you accept the revised policy.
          </p>
        </Section>

        <Section n="13." title="Contact us">
          <p>
            {COMPANY}<br />
            Attn: Ali Raza<br />
            Email: <a href={`mailto:${EMAIL}`} className="text-blood hover:text-blood-glow break-all">{EMAIL}</a>
          </p>
        </Section>
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
            <a href="/verify" className="hover:text-blood transition">Verify Certificate</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
