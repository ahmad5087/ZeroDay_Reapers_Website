import { NextResponse } from "next/server";
import { COUNTRIES } from "@/lib/countries";

// Resolve the caller's approximate city/country SERVER-SIDE. This replaces the old client-side geo fetch,
// which was being blocked on some networks/ad-blockers (location came back "unknown"). Server-side is
// reliable, first-party (no CORS), and on Vercel needs no external call at all — the platform injects geo
// headers on every request. Only coarse city/country is ever returned; the raw IP never leaves the server.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function countryName(code) {
  if (!code) return null;
  if (code.length !== 2) return code; // already a full name (from a fallback provider)
  return COUNTRIES.find((c) => c.code === code.toUpperCase())?.name || code;
}

export async function GET(req) {
  const h = req.headers;

  // 1) Vercel edge geolocation headers — free, instant, no outbound call.
  let city = h.get("x-vercel-ip-city");
  let country = h.get("x-vercel-ip-country"); // ISO alpha-2
  if (city) { try { city = decodeURIComponent(city); } catch { /* keep raw */ } }
  country = countryName(country);

  // 2) Fallback (non-Vercel hosts / missing headers): resolve from the client IP with a server-side
  //    lookup. Not subject to browser CORS/ad-blocking, and we try two providers for resilience.
  if (!city && !country) {
    const fwd = h.get("x-forwarded-for") || "";
    const ip = fwd.split(",")[0].trim() || h.get("x-real-ip") || "";
    // ipwho.is (https, full country name)
    try {
      const r = await fetch(`https://ipwho.is/${ip}`, { cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (j && j.success !== false) { city = j.city || null; country = j.country || null; } }
    } catch { /* try next */ }
    // ipapi.co as a second attempt
    if (!city && !country) {
      try {
        const r = await fetch(`https://ipapi.co/${ip ? ip + "/" : ""}json/`, { cache: "no-store" });
        if (r.ok) { const j = await r.json(); if (!j.error) { city = j.city || null; country = j.country_name || null; } }
      } catch { /* give up gracefully */ }
    }
  }

  return NextResponse.json({ city: city || null, country: country || null });
}
