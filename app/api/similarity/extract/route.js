import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { presignGet, getAuthedUser } from "@/lib/r2";

export const runtime = "nodejs";
export const maxDuration = 60;

// Extract PDF text for submissions, fingerprint with MinHash, and (re)compute admin-visible
// similarity pairs. Admin-triggered from the Similarity tab. Lexical only (the Pi can't do embeddings);
// same-author pairs are ignored; results are review-only and never auto-penalize. Flag: submission_similarity.
const THRESHOLD = 0.30;   // report pairs at/above this estimated Jaccard
const NUM_HASHES = 100;
const SHINGLE = 5;        // words per shingle
const PRIME = 2147483647; // 2^31 - 1

// Fixed hash-function family, so signatures are comparable across runs.
function hashParams() {
  const a = [], b = [];
  let seed = 1234567;
  const rnd = () => (seed = (seed * 48271) % PRIME);
  for (let i = 0; i < NUM_HASHES; i++) { a.push(1 + (rnd() % (PRIME - 1))); b.push(rnd() % PRIME); }
  return { a, b };
}
const { a: HA, b: HB } = hashParams();

const normalize = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
function fnv(str) { // 32-bit FNV-1a → [0, PRIME)
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h % PRIME;
}
function minhash(norm) {
  const words = norm.split(" ").filter(Boolean);
  const shingles = new Set();
  for (let i = 0; i + SHINGLE <= words.length; i++) shingles.add(words.slice(i, i + SHINGLE).join(" "));
  if (shingles.size === 0) return null;
  const sig = new Array(NUM_HASHES).fill(PRIME);
  for (const s of shingles) {
    const h = fnv(s);
    for (let i = 0; i < NUM_HASHES; i++) {
      const v = (HA[i] * h + HB[i]) % PRIME;
      if (v < sig[i]) sig[i] = v;
    }
  }
  return sig;
}
function jaccard(sa, sb) {
  if (!sa || !sb || sa.length !== sb.length) return 0;
  let m = 0;
  for (let i = 0; i < sa.length; i++) if (Number(sa[i]) === Number(sb[i])) m++;
  return m / sa.length;
}
function sharedPassages(textA, textB) {
  const setB = new Set(String(textB || "").split(/[.!?\n]+/).map(normalize).filter((s) => s.length >= 40));
  const out = [];
  for (const raw of String(textA || "").split(/[.!?\n]+/)) {
    if (normalize(raw).length >= 40 && setB.has(normalize(raw))) { out.push(raw.trim()); if (out.length >= 5) break; }
  }
  return out;
}
async function getPdfParse() {
  const mod = await import("pdf-parse/lib/pdf-parse.js"); // import the lib directly (avoids the debug file read)
  return mod.default || mod;
}

export async function POST(req) {
  const user = await getAuthedUser(req);
  if (!user || user.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "service role not configured" }, { status: 503 });
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit) || 40, 100);

  // Which submissions to extract: a single id, or all un-extracted PDFs (bounded per call).
  let q = db.from("submissions").select("id,file_path,file_name,user_id,task_id").not("file_path", "is", null);
  if (body.submissionId) q = q.eq("id", body.submissionId);
  const { data: subs } = await q;
  const { data: existing } = await db.from("submission_text").select("submission_id");
  const done = new Set((existing || []).map((r) => r.submission_id));
  const todo = (subs || []).filter((s) => body.submissionId || !done.has(s.id)).slice(0, limit);

  const pdfParse = await getPdfParse();
  let extracted = 0;
  for (const s of todo) {
    try {
      if (!/\.pdf$/i.test(s.file_path)) continue;
      const link = await presignGet(s.file_path);
      const res = await fetch(link);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const parsed = await pdfParse(buf);
      const content = (parsed.text || "").trim();
      await db.from("submission_text").upsert({
        submission_id: s.id, content, char_len: content.length, minhash: minhash(normalize(content)),
        extracted_at: new Date().toISOString(),
      });
      extracted++;
    } catch { /* skip a bad/locked file, keep going */ }
  }

  // Recompute pairs across all extracted docs (bounded cohort). Denormalize labels for the UI.
  const { data: all } = await db.from("submission_text").select("submission_id,content,minhash");
  const ids = (all || []).map((r) => r.submission_id);
  const metaById = new Map();
  if (ids.length) {
    const { data: meta } = await db.from("submissions")
      .select("id,user_id,task_id,profiles:profiles!submissions_user_id_fkey(display_name,member_id),tasks(week,title)")
      .in("id", ids);
    (meta || []).forEach((m) => metaById.set(m.id, m));
  }
  const label = (id) => {
    const m = metaById.get(id);
    return m ? `${m.profiles?.display_name || "Intern"}${m.tasks?.week != null ? ` · W${m.tasks.week}` : ""}` : `#${id}`;
  };

  let pairs = 0;
  const rows = all || [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const A = rows[i], B = rows[j];
      const ma = metaById.get(A.submission_id), mb = metaById.get(B.submission_id);
      if (ma && mb && ma.user_id === mb.user_id) continue;   // same author ≠ plagiarism
      const score = jaccard(A.minhash, B.minhash);
      if (score < THRESHOLD) continue;
      const aId = Math.min(A.submission_id, B.submission_id);
      const bId = Math.max(A.submission_id, B.submission_id);
      const lo = aId === A.submission_id ? A : B;
      const hi = aId === A.submission_id ? B : A;
      await db.from("similarity_pairs").upsert({
        a_id: aId, b_id: bId, a_label: label(aId), b_label: label(bId),
        score: Math.round(score * 100) / 100, matched: sharedPassages(lo.content, hi.content),
        computed_at: new Date().toISOString(),
        // NOTE: `dismissed` is intentionally omitted so a recompute preserves an admin's dismissal.
      }, { onConflict: "a_id,b_id" });
      pairs++;
    }
  }

  return NextResponse.json({ ok: true, extracted, pairs });
}
