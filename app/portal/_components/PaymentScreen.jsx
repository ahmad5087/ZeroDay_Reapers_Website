"use client";

import { useState } from "react";

// Regional payment options for the internship fee. Interns pick the region that matches
// their location and transfer to the corresponding account, then upload a screenshot of the
// payment on their Profile (Week 3 Payment Proof section).
const REGIONS = [
  {
    key: "india",
    label: "Indian Interns",
    sub: null,
    flag: "🇮🇳",
    method: "PayPal",
    note: "Send the fee to the PayPal account below.",
    rows: [
      ["Beneficiary Name", "Muhammad Musaffa"],
      ["PayPal Username", "@musaffasaeed"],
      ["PayPal Email", "muhammadmusaffa001@gmail.com"],
    ],
  },
  {
    key: "intl",
    label: "International Interns",
    sub: "(except India)",
    flag: "🌍",
    method: "Bank Transfer — IBAN / SWIFT",
    note: "Send an international transfer via your bank or a service such as Wise, Remitly, or Payoneer.",
    rows: [
      ["Beneficiary Name", "Ali Raza"],
      ["Bank Name", "NayaPay"],
      ["IBAN", "PK61NAYA1234503114280312"],
      ["SWIFT / BIC", "NAYAPKK2"],
    ],
  },
  {
    key: "pakistan",
    label: "Pakistani Interns",
    sub: null,
    flag: "🇵🇰",
    method: "NayaPay",
    note: "Transfer instantly using NayaPay, or via IBAN from any local bank / Raast.",
    rows: [
      ["NayaPay Name", "Ali Raza"],
      ["NayaPay ID", "ali2764@nayapay"],
      ["Account Number", "03114280312"],
      ["IBAN", "PK61NAYA1234503114280312"],
    ],
  },
];

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can still select the text */ }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-neutral-800 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-neutral-500">{label}</p>
        <p className="text-sm text-white break-all select-all">{value}</p>
      </div>
      <button
        onClick={copy}
        className="shrink-0 font-mono text-[10px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-2.5 py-1.5 rounded-sm hover:border-blood hover:text-blood transition"
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </div>
  );
}

export default function PaymentScreen({ me, onBack, onGoToProfile }) {
  const [active, setActive] = useState("pakistan");
  const region = REGIONS.find((r) => r.key === active);
  const submitted = !!me?.payment_proof_url;

  return (
    <div className="min-h-screen text-white">
      <header className="border-b border-blood/20 bg-black/80 backdrop-blur sticky top-0 z-10">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
          <h1 className="font-mono text-xs sm:text-sm uppercase tracking-widest">Internship Fee Payment</h1>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back
          </button>
        </div>
      </header>

      <main className="w-full max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6 font-mono">
        <p className="text-sm text-neutral-400 leading-relaxed">
          Select the option that matches your location, then transfer the internship fee to the
          account shown. Tap <span className="text-neutral-200">Copy</span> to grab any detail exactly.
        </p>

        {/* Region selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {REGIONS.map((r) => {
            const on = r.key === active;
            return (
              <button
                key={r.key}
                onClick={() => setActive(r.key)}
                className={`text-left rounded-sm border px-3 py-3 transition ${
                  on
                    ? "border-blood bg-blood/10 text-white"
                    : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
                }`}
              >
                <div className="text-lg leading-none">{r.flag}</div>
                <div className="mt-1.5 text-[11px] uppercase tracking-widest font-bold">{r.label}</div>
                {r.sub && <div className="text-[10px] text-neutral-500 normal-case tracking-normal">{r.sub}</div>}
              </button>
            );
          })}
        </div>

        {/* Selected region details */}
        <div className="panel border border-blood/20 rounded-sm p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm uppercase tracking-widest text-white flex items-center gap-2">
                <span>{region.flag}</span> {region.label}
              </h2>
              <p className="text-[11px] uppercase tracking-widest text-blood mt-1">{region.method}</p>
            </div>
          </div>
          <p className="text-xs text-neutral-400 leading-relaxed">{region.note}</p>
          <div className="rounded-sm bg-black/40 border border-neutral-800 px-4 py-1">
            {region.rows.map(([label, value]) => (
              <CopyRow key={label} label={label} value={value} />
            ))}
          </div>
        </div>

        {/* Proof-of-payment policy */}
        <div className="rounded-sm border border-amber-500/40 bg-amber-500/5 p-5 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-amber-400 font-bold flex items-center gap-2">
            <span>📸</span> Upload your payment screenshot
          </h3>
          <p className="text-xs text-neutral-300 leading-relaxed">
            After paying, you <span className="text-white font-semibold">must upload a screenshot</span> of
            the payment on the Portal — open <span className="text-white font-semibold">Profile → Week 3
            Internship Fee Payment Proof</span>.
          </p>
          <p className="text-[12px] text-neutral-400 bg-black/40 border-l-2 border-red-500 rounded-r-sm p-3 leading-relaxed">
            ⚠️ If you upload the <span className="text-red-400 font-semibold">wrong screenshot</span> or
            <span className="text-red-400 font-semibold"> forget to upload</span> your payment screenshot,
            I am <span className="text-red-400 font-semibold">not responsible for your negligence</span>.
          </p>

          {onGoToProfile && (
            <button
              onClick={onGoToProfile}
              className={`w-full sm:w-auto text-xs uppercase tracking-widest px-5 py-3 rounded-sm transition ${
                submitted
                  ? "border border-neutral-700 text-neutral-300 hover:border-[#34d399] hover:text-[#34d399]"
                  : "btn-neon font-bold hover:bg-blood-glow"
              }`}
            >
              {submitted ? "✅ Proof submitted — view on Profile" : "Upload payment screenshot →"}
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
