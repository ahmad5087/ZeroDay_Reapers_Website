"use client";

import { useState } from "react";

const LINKS = [
  ["Services", "#services"],
  ["Internships", "#internships"],
  ["Community", "#whatsapp"],
  ["About", "#about"],
  ["Team", "#ceo"],
  ["Contact", "#contact"],
];

// Mobile-only hamburger menu for the marketing nav (desktop uses the inline links).
export default function MobileNav({ whatsapp, discord }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        className="text-neutral-300 hover:text-blood p-2 -mr-2"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? (
            <>
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </>
          ) : (
            <>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </>
          )}
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full bg-black border-b border-blood/20 px-6 py-5 flex flex-col gap-1 font-mono text-xs uppercase tracking-widest shadow-xl">
          {LINKS.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)} className="text-neutral-300 hover:text-blood py-2.5 border-b border-blood/10">
              {label}
            </a>
          ))}
          <div className="flex gap-3 pt-4">
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex-1 text-center border border-[#25D366]/60 text-[#25D366] px-4 py-2.5 rounded-sm"
            >
              WhatsApp
            </a>
            <a
              href={discord}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="flex-1 text-center bg-blood text-ink-950 px-4 py-2.5 rounded-sm"
            >
              Discord
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
