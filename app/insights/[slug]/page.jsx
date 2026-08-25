import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import ReactMarkdown from "react-markdown";

// Public post page (Phase 7, #10). Server component with SEO via generateMetadata. react-markdown does
// NOT render raw HTML, so admin-authored markdown is safe to render. RLS shows only published posts.
export const revalidate = 300;

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anon ? createClient(url, anon, { auth: { persistSession: false } }) : null;
}
async function getPost(slug) {
  try {
    const sb = client();
    if (!sb) return null;
    const { data } = await sb.from("posts").select("*").eq("slug", slug).eq("status", "published").maybeSingle();
    return data || null;
  } catch { return null; }
}

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const p = await getPost(slug);
  if (!p) return { title: "Not found — ZeroDay Reapers" };
  const meta = p.seo_meta || {};
  const title = `${meta.title || p.title} — ZeroDay Reapers`;
  const description = meta.description || p.excerpt || undefined;
  const url = `/insights/${slug}`;
  // OG image is auto-attached from ./opengraph-image.js; canonical + article tags help ranking/sharing.
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "article", publishedTime: p.published_at || undefined },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PostPage({ params }) {
  const { slug } = await params;
  const p = await getPost(slug);
  if (!p) notFound();
  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: p.title,
    description: p.excerpt || undefined,
    datePublished: p.published_at || undefined,
    author: { "@type": "Organization", name: "ZeroDay Reapers" },
    publisher: { "@type": "Organization", name: "ZeroDay Reapers" },
    mainEntityOfPage: `/insights/${slug}`,
  };
  // Escaping "<" prevents database content from closing the script element with a </script> sequence.
  const safeLdJson = JSON.stringify(ld).replace(/</g, "\\u003c");
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, Segoe UI, Arial, sans-serif", lineHeight: 1.7, color: "#111" }}>
      {/* nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml -- safeLdJson escapes script-closing input. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeLdJson }} />
      <Link href="/insights" style={{ color: "#e10600", textDecoration: "none", fontSize: 13 }}>← Insights</Link>
      <h1 style={{ fontSize: 34, margin: "12px 0 6px" }}>{p.title}</h1>
      {p.published_at && <p style={{ color: "#888", fontSize: 13, marginBottom: 24 }}>{new Date(p.published_at).toLocaleDateString()}</p>}
      <article style={{ fontSize: 16 }}>
        <ReactMarkdown>{p.body || ""}</ReactMarkdown>
      </article>
    </main>
  );
}
