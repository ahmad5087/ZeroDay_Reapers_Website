"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function VerifyPage() {
  const [id, setId] = useState("");
  const router = useRouter();

  const submit = (e) => {
    e.preventDefault();
    const clean = id.trim().toUpperCase();
    if (clean) router.push(`/verify/${encodeURIComponent(clean)}`);
  };

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
          <Link href="/" className="font-mono text-xs uppercase tracking-widest text-neutral-400 hover:text-blood transition">
            ← Home
          </Link>
        </nav>
      </header>

      <section className="relative flex-1 max-w-2xl mx-auto w-full px-6 pt-24 pb-24">
        <div className="font-mono text-xs uppercase tracking-[0.4em] text-blood mb-4">
          &gt; verify --credential
        </div>
        <h1 className="font-mono text-4xl md:text-6xl text-white text-glow leading-tight">
          Verify a <span className="text-blood">Certificate</span>
        </h1>
        <p className="mt-6 text-neutral-400 leading-relaxed">
          Enter the Certificate ID printed on the certificate — or scan the QR code, which
          brings you straight to the credential page.
        </p>

        <form onSubmit={submit} className="mt-10 space-y-3">
          <label className="block font-mono text-xs uppercase tracking-widest text-neutral-500">
            Certificate ID
          </label>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="ZDR-2026-OS-0417"
            spellCheck={false}
            autoFocus
            className="w-full bg-ink-900 border border-blood/40 focus:border-blood outline-none px-5 py-4 font-mono text-lg text-white placeholder:text-neutral-600 focus:shadow-[0_0_24px_rgba(225,6,0,0.35)] transition-all"
          />
          <button
            type="submit"
            className="w-full mt-4 font-mono text-sm uppercase tracking-widest bg-blood text-ink-950 px-6 py-4 rounded-sm shadow-[0_0_24px_rgba(225,6,0,0.55)] hover:shadow-[0_0_40px_rgba(255,26,26,0.9)] hover:bg-blood-glow transition-all"
          >
            Verify →
          </button>
        </form>

        <p className="mt-8 text-xs text-neutral-500 font-mono">
          Format: <span className="text-neutral-300">ZDR-YEAR-DEPT-NNNN</span>
          {" · "}Case-insensitive.
        </p>
      </section>

      <footer className="border-t border-blood/10 bg-black">
        <div className="max-w-6xl mx-auto px-6 py-6 font-mono text-xs text-neutral-500 text-center">
          © {new Date().getFullYear()} ZeroDay Reapers
        </div>
      </footer>
    </main>
  );
}
