import Link from "next/link";
import certificates from "@/data/certificates.json";

export async function generateMetadata({ params }) {
  const { id } = await params;
  const cert = certificates[id.toUpperCase()];
  return {
    title: cert
      ? `Verified — ${cert.name} · ${id.toUpperCase()}`
      : `Certificate ${id.toUpperCase()} — Not Found`,
    robots: { index: false },
  };
}

export default async function VerifyResult({ params }) {
  const { id: raw } = await params;
  const id = raw.toUpperCase();
  const cert = certificates[id];

  return (
    <main className="relative min-h-screen bg-ink-950 text-neutral-200 flex flex-col">
      <div className="pointer-events-none fixed inset-0 grid-bg opacity-40" />
      <div className="pointer-events-none fixed inset-x-0 top-0 h-[70vh] red-glow" />

      <header className="sticky top-0 z-50 bg-black border-b border-blood/20">
        <nav className="max-w-6xl mx-auto flex items-center justify-between px-6 py-3">
          <Link href="/" className="flex items-center gap-3">
            <img src="/logo.svg" alt="ZeroDay Reapers" width={44} height={44} className="h-11 w-11 animate-glow-pulse" />
            <span className="font-mono text-sm tracking-widest text-white text-glow">
              ZERO<span className="text-blood">DAY</span> REAPERS
            </span>
          </Link>
          <Link href="/verify" className="font-mono text-xs uppercase tracking-widest text-neutral-400 hover:text-blood transition">
            Verify Another
          </Link>
        </nav>
      </header>

      <section className="relative flex-1 max-w-3xl mx-auto w-full px-6 pt-16 pb-24">
        {cert ? <ValidCert id={id} cert={cert} /> : <InvalidCert id={id} />}
      </section>

      <footer className="border-t border-blood/10 bg-black">
        <div className="max-w-6xl mx-auto px-6 py-6 font-mono text-xs text-neutral-500 text-center">
          © {new Date().getFullYear()} ZeroDay Reapers · Credential database maintained by ZeroDay Reapers HQ
        </div>
      </footer>
    </main>
  );
}

function ValidCert({ id, cert }) {
  return (
    <>
      <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-emerald-400 border border-emerald-400/40 px-3 py-1.5 rounded-sm">
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        Verified · Authentic
      </div>

      <h1 className="mt-6 font-mono text-3xl md:text-5xl text-white text-glow leading-tight">
        This certificate is <span className="text-blood">genuine.</span>
      </h1>
      <p className="mt-4 text-neutral-400">
        Issued by ZeroDay Reapers to the individual named below.
      </p>

      <div className="mt-10 border border-blood/30 bg-ink-900/60 backdrop-blur p-8 md:p-10 shadow-[0_0_60px_rgba(225,6,0,0.15)]">
        <div className="font-mono text-xs uppercase tracking-[0.3em] text-blood mb-2">
          Certificate ID
        </div>
        <div className="font-mono text-2xl md:text-3xl text-white break-all">{id}</div>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <Field label="Awarded To" value={cert.name} big />
          <Field label="Type" value={cert.type} />
          <Field label="Department" value={cert.department} />
          <Field label="Cohort" value={`#${cert.cohort}`} />
          <Field label="Program Period" value={cert.period} />
          <Field label="Date Issued" value={cert.issued} />
        </div>
      </div>

      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          href="/verify"
          className="font-mono text-sm uppercase tracking-widest border border-blood text-blood px-6 py-3 hover:bg-blood hover:text-ink-950 transition"
        >
          Verify Another
        </Link>
        <Link
          href="/"
          className="font-mono text-sm uppercase tracking-widest border border-neutral-700 text-neutral-300 px-6 py-3 hover:border-blood hover:text-blood transition"
        >
          ← Back to Home
        </Link>
      </div>
    </>
  );
}

function InvalidCert({ id }) {
  return (
    <>
      <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.3em] text-blood border border-blood/50 px-3 py-1.5 rounded-sm">
        <span className="h-2 w-2 rounded-full bg-blood animate-pulse" />
        Not Verified
      </div>

      <h1 className="mt-6 font-mono text-3xl md:text-5xl text-white leading-tight">
        No certificate <span className="text-blood">matches this ID.</span>
      </h1>
      <p className="mt-4 text-neutral-400 max-w-xl">
        The Certificate ID <span className="font-mono text-white">{id}</span> is not in our
        credential database. This could mean the ID was mistyped, or the certificate is not
        authentic.
      </p>

      <div className="mt-10 border border-blood/20 bg-ink-900/60 p-8 space-y-4 text-sm text-neutral-400">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-blood mb-1">Recheck</div>
          Retype the ID exactly as printed. Format is <span className="text-white font-mono">ZDR-YEAR-DEPT-NNNN</span>.
        </div>
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.3em] text-blood mb-1">Report</div>
          Believe a certificate is being misrepresented? Email{" "}
          <a href="mailto:0zerodayreapers0@gmail.com" className="text-white hover:text-blood underline">
            0zerodayreapers0@gmail.com
          </a>
          .
        </div>
      </div>

      <div className="mt-10 flex flex-wrap gap-4">
        <Link
          href="/verify"
          className="font-mono text-sm uppercase tracking-widest bg-blood text-ink-950 px-6 py-3 shadow-[0_0_24px_rgba(225,6,0,0.55)] hover:shadow-[0_0_40px_rgba(255,26,26,0.9)] hover:bg-blood-glow transition-all"
        >
          Try Another ID
        </Link>
        <Link
          href="/"
          className="font-mono text-sm uppercase tracking-widest border border-neutral-700 text-neutral-300 px-6 py-3 hover:border-blood hover:text-blood transition"
        >
          ← Back to Home
        </Link>
      </div>
    </>
  );
}

function Field({ label, value, big = false }) {
  return (
    <div>
      <div className="font-mono text-xs uppercase tracking-[0.3em] text-neutral-500 mb-1.5">{label}</div>
      <div className={`text-white ${big ? "font-mono text-2xl" : "text-lg"}`}>{value}</div>
    </div>
  );
}
