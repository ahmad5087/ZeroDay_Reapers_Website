import { NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";
import { getAuthedUser, rateLimit } from "@/lib/r2";

export const runtime = "nodejs";

// In-memory cache (per warm instance). Serverless instances don't share it, but it still
// collapses repeated unfurls of the same link and shields origins from render storms.
const CACHE = new Map(); // url -> { at, data }
const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_HTML = 262_144;   // only need <head>; cap the read at 256 KB
const FETCH_TIMEOUT = 6000;

// ---- SSRF guards: never let a user make the server fetch internal/metadata endpoints ----
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;             // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;   // CGNAT
    if (a >= 224) return true;                            // multicast / reserved
    return false;
  }
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  if (s.startsWith("::ffff:")) return isPrivateIp(s.slice(7)); // IPv4-mapped IPv6
  if (s.startsWith("fe80") || s.startsWith("fc") || s.startsWith("fd")) return true; // link-local + ULA
  return false;
}

async function resolvesToPublic(hostname) {
  if (net.isIP(hostname)) return !isPrivateIp(hostname);
  try {
    const addrs = await dns.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch { return false; }
}

// Fetch following redirects manually so every hop is re-validated against the SSRF guards.
async function safeFetch(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    if (u.port && !["80", "443"].includes(u.port)) throw new Error("bad port");
    if (!(await resolvesToPublic(u.hostname))) throw new Error("blocked host");

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    let res;
    try {
      res = await fetch(u.href, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": "ZeroDayReapersBot/1.0 (+link-preview)", accept: "text/html,application/xhtml+xml,*/*" },
      });
    } finally { clearTimeout(timer); }

    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, u.href).href; continue; }
    return { res, finalUrl: u.href };
  }
  throw new Error("too many redirects");
}

function decodeEntities(s = "") {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'").replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch { return ""; } })
    .replace(/&amp;/g, "&"); // last, so we never double-decode
}

function absoluteHttp(u, base) {
  try { const r = new URL(u, base).href; return /^https?:\/\//i.test(r) ? r : ""; } catch { return ""; }
}

function parseOg(html, baseUrl) {
  const pick = (re) => { const m = html.match(re); return m ? decodeEntities(m[1]).trim() : ""; };
  const meta = (prop) =>
    pick(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']*)["']`, "i")) ||
    pick(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${prop}["']`, "i"));

  const title = (meta("og:title") || meta("twitter:title") || pick(/<title[^>]*>([\s\S]*?)<\/title>/i)).slice(0, 300);
  const description = (meta("og:description") || meta("twitter:description") || meta("description")).slice(0, 500);
  let image = meta("og:image") || meta("og:image:url") || meta("og:image:secure_url") || meta("twitter:image") || meta("twitter:image:src");
  image = image ? absoluteHttp(image, baseUrl) : "";
  const siteName = meta("og:site_name").slice(0, 120);
  return { title, description, image, siteName };
}

export async function GET(req) {
  const user = await getAuthedUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!rateLimit("link-preview:" + user.id, { limit: 60, windowMs: 60_000 }))
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const raw = req.nextUrl.searchParams.get("url") || "";
  if (!raw || raw.length > 2048) return NextResponse.json({ error: "Bad url" }, { status: 400 });

  let target;
  try {
    target = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
    if (target.protocol !== "http:" && target.protocol !== "https:") throw new Error();
  } catch { return NextResponse.json({ error: "Bad url" }, { status: 400 }); }

  const key = target.href;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return NextResponse.json(hit.data);

  try {
    const { res, finalUrl } = await safeFetch(target.href);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    if (!res.ok || !ct.includes("html")) {
      const empty = { url: finalUrl };
      CACHE.set(key, { at: Date.now(), data: empty });
      return NextResponse.json(empty);
    }
    // Read only enough for <head>.
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (received < MAX_HTML) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    try { await reader.cancel(); } catch { /* already closed */ }
    const html = Buffer.concat(chunks).toString("utf8");

    const og = parseOg(html, finalUrl);
    const data = { url: finalUrl, ...og };
    CACHE.set(key, { at: Date.now(), data });
    if (CACHE.size > 3000) { for (const k of CACHE.keys()) { CACHE.delete(k); if (CACHE.size <= 1500) break; } }
    return NextResponse.json(data);
  } catch {
    // Don't cache hard failures for long — origin might be briefly down.
    return NextResponse.json({ url: target.href }, { status: 200 });
  }
}
