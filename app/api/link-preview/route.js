import { NextResponse } from "next/server";
import dns from "node:dns/promises";
import net from "node:net";
import https from "node:https";
import http from "node:http";
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

// Resolve a hostname to a single, pre-validated PUBLIC ip (or throw). Blocking if ANY resolved address is
// private defends against split-horizon DNS; returning the exact ip lets us pin the connection to it.
async function firstPublicIp(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) throw new Error("blocked host");
    return hostname;
  }
  let addrs;
  try { addrs = await dns.lookup(hostname, { all: true }); }
  catch { throw new Error("blocked host"); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new Error("blocked host");
  return addrs[0].address;
}

// Force the socket to connect to the pre-validated ip — this closes the DNS-rebinding TOCTOU window (the
// host can't resolve to a public ip for the check and a private one for the fetch). TLS still uses the URL
// hostname for SNI + certificate validation, so HTTPS keeps working normally. Node's happy-eyeballs calls
// lookup with { all:true } and expects an array back, so handle both shapes.
function pinnedLookup(ip) {
  const family = net.isIPv6(ip) ? 6 : 4;
  return (_hostname, options, cb) => {
    if (options && options.all) return cb(null, [{ address: ip, family }]);
    return cb(null, ip, family);
  };
}

// One GET to a validated, pinned ip. Reads at most MAX_HTML bytes (we only need <head>), with a hard
// timeout. Returns a normalized { statusCode, headers, body }. Never auto-follows redirects — safeFetch
// re-validates each hop itself.
function requestPinned(u, ip) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    let settled = false;
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: (u.pathname || "/") + (u.search || ""),
        method: "GET",
        servername: u.hostname, // SNI stays the real hostname
        lookup: pinnedLookup(ip),
        headers: { "user-agent": "ZeroDayReapersBot/1.0 (+link-preview)", accept: "text/html,application/xhtml+xml,*/*" },
      },
      (res) => {
        const chunks = [];
        let received = 0;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve({ statusCode: res.statusCode || 0, headers: res.headers, body: Buffer.concat(chunks) });
        };
        res.on("data", (c) => {
          received += c.length;
          chunks.push(c);
          if (received >= MAX_HTML) res.destroy(); // enough for <head>; 'close' resolves with what we have
        });
        res.on("end", finish);
        res.on("close", finish);
        res.on("error", finish); // partial body is still fine for OG parsing
      }
    );
    req.setTimeout(FETCH_TIMEOUT, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => { if (!settled) { settled = true; reject(e); } });
    req.end();
  });
}

// Fetch following redirects manually so every hop is re-resolved, re-validated, and re-pinned.
async function safeFetch(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("bad protocol");
    if (u.port && !["80", "443"].includes(u.port)) throw new Error("bad port");
    const ip = await firstPublicIp(u.hostname);
    const r = await requestPinned(u, ip);
    const loc = r.headers["location"];
    if (r.statusCode >= 300 && r.statusCode < 400 && loc) { url = new URL(loc, u.href).href; continue; }
    return {
      ok: r.statusCode >= 200 && r.statusCode < 300,
      contentType: String(r.headers["content-type"] || "").toLowerCase(),
      body: r.body,
      finalUrl: u.href,
    };
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
    const { ok, contentType, body, finalUrl } = await safeFetch(target.href);
    if (!ok || !contentType.includes("html")) {
      const empty = { url: finalUrl };
      CACHE.set(key, { at: Date.now(), data: empty });
      return NextResponse.json(empty);
    }
    const html = body.toString("utf8");
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
