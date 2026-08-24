import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import Subscribe from "../_components/Subscribe";

// Public index of published posts (Phase 7, #10). Server component — fetched at request time via the
// anon client (RLS shows only status='published'). Rendered in the MAIN app (Supabase already
// configured here) rather than the separate portfolio/ app.
export const revalidate = 300;

export const metadata = {
  title: "Insights — ZeroDay Reapers",
  description: "Case studies, research, and security advisories from ZeroDay Reapers.",
};

const TYPE_LABEL = { case_study: "Case study", research: "Research", advisory: "Advisory", success_story: "Success story" };

async function getPosts() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return [];
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const { data } = await sb.from("posts").select("slug,type,title,excerpt,published_at")
      .eq("status", "published").order("published_at", { ascending: false });
    return data || [];
  } catch { return []; }
}

export default async function InsightsPage() {
  const posts = await getPosts();
  return (
    <main style={{ maxWidth: 820, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, Segoe UI, Arial, sans-serif" }}>
      <h1 style={{ fontSize: 32, marginBottom: 8 }}>Insights</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>Case studies, research, and security advisories from ZeroDay Reapers.</p>
      {posts.length === 0 ? (
        <p style={{ color: "#888" }}>No posts published yet.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 20 }}>
          {posts.map((p) => (
            <li key={p.slug} style={{ borderBottom: "1px solid #eee", paddingBottom: 16 }}>
              <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: "#e10600" }}>{TYPE_LABEL[p.type] || p.type}</div>
              <Link href={`/insights/${p.slug}`} style={{ fontSize: 20, fontWeight: 700, color: "#111", textDecoration: "none" }}>{p.title}</Link>
              {p.excerpt && <p style={{ color: "#555", marginTop: 6 }}>{p.excerpt}</p>}
            </li>
          ))}
        </ul>
      )}
      <div style={{ marginTop: 48, paddingTop: 28, borderTop: "1px solid #eee" }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Get new case studies &amp; advisories</h2>
        <p style={{ color: "#666", fontSize: 14, marginTop: 6 }}>No spam — just our latest security research and outcomes.</p>
        <Subscribe source="insights" />
      </div>
    </main>
  );
}
