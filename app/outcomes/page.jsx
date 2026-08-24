import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

// Public outcomes page (Phase 12 — growth). Alumni success stories (published posts of type
// 'success_story', Phase 7) + live cohort/agency aggregates (get_public_stats, Phase 11). Reuses
// existing infra — no new table, no PII. Great applicant + client proof; self-degrades if empty.
export const revalidate = 300;
export const metadata = {
  title: "Outcomes — ZeroDay Reapers",
  description: "Alumni success stories and cohort outcomes from the ZeroDay Reapers internship.",
  alternates: { canonical: "/outcomes" },
};

async function getData() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return { posts: [], stats: null };
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const [{ data: posts }, { data: stats }] = await Promise.all([
      sb.from("posts").select("slug,title,excerpt,published_at").eq("status", "published").eq("type", "success_story").order("published_at", { ascending: false }),
      sb.rpc("get_public_stats"),
    ]);
    return { posts: posts || [], stats: stats || null };
  } catch { return { posts: [], stats: null }; }
}

const STAT_TILES = [
  { key: "interns_trained", label: "Interns trained" },
  { key: "certificates_issued", label: "Certificates issued" },
  { key: "deliverables_approved", label: "Deliverables approved" },
  { key: "projects_delivered", label: "Projects delivered" },
];

export default async function OutcomesPage() {
  const { posts, stats } = await getData();
  const tiles = stats ? STAT_TILES.filter((t) => Number(stats[t.key] || 0) > 0) : [];
  const wrap = { maxWidth: 820, margin: "0 auto", padding: "56px 20px", fontFamily: "system-ui, Segoe UI, Arial, sans-serif", color: "#141414" };

  return (
    <main style={wrap}>
      <p style={{ color: "#e10600", fontSize: 12, textTransform: "uppercase", letterSpacing: 2, fontWeight: 700 }}>Outcomes</p>
      <h1 style={{ fontSize: 34, margin: "8px 0 10px" }}>Where the work goes</h1>
      <p style={{ color: "#555", fontSize: 16, lineHeight: 1.6 }}>Real training, real deliverables, real careers — measured, not claimed.</p>

      {tiles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, margin: "28px 0 8px" }}>
          {tiles.map((t) => (
            <div key={t.key} style={{ border: "1px solid #eee", borderRadius: 8, padding: "16px 18px" }}>
              <div style={{ fontSize: 30, fontWeight: 800 }}>{Number(stats[t.key]).toLocaleString()}</div>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 1, color: "#888", marginTop: 4 }}>{t.label}</div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 20, margin: "36px 0 12px", borderBottom: "2px solid #e10600", paddingBottom: 6 }}>Success stories</h2>
      {posts.length === 0 ? (
        <p style={{ color: "#888" }}>Success stories are on the way — check back soon.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 18 }}>
          {posts.map((p) => (
            <li key={p.slug} style={{ borderBottom: "1px solid #eee", paddingBottom: 14 }}>
              <Link href={`/insights/${p.slug}`} style={{ fontSize: 19, fontWeight: 700, color: "#111", textDecoration: "none" }}>{p.title}</Link>
              {p.excerpt && <p style={{ color: "#555", marginTop: 6 }}>{p.excerpt}</p>}
            </li>
          ))}
        </ul>
      )}

      <p style={{ color: "#666", fontSize: 15, marginTop: 40, paddingTop: 20, borderTop: "1px solid #eee" }}>
        Want in? <Link href="/apply" style={{ color: "#e10600", fontWeight: 600 }}>Join the next cohort →</Link>
      </p>
    </main>
  );
}
