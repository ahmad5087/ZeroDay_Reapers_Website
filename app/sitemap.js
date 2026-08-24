import { createClient } from "@supabase/supabase-js";

// Dynamic sitemap.xml (Phase 11 — SEO). Static marketing routes + every PUBLISHED Insights post
// (case studies are the organic client-acquisition surface). Revalidated hourly; degrades to the
// static routes if Supabase is unreachable. Token/private routes are intentionally excluded.
const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://zerodayreapers.me";
export const revalidate = 3600;

async function getPosts() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return [];
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const { data } = await sb.from("posts").select("slug,published_at").eq("status", "published");
    return data || [];
  } catch { return []; }
}

export default async function sitemap() {
  const posts = await getPosts();
  const now = new Date();
  const staticRoutes = [
    { path: "", priority: 1.0 },
    { path: "/insights", priority: 0.8 },
    { path: "/outcomes", priority: 0.8 },
    { path: "/apply", priority: 0.8 },
    { path: "/start-project", priority: 0.7 },
    { path: "/verify", priority: 0.5 },
  ].map((r) => ({ url: `${BASE}${r.path}`, lastModified: now, changeFrequency: "weekly", priority: r.priority }));

  const postRoutes = posts.map((p) => ({
    url: `${BASE}/insights/${p.slug}`,
    lastModified: p.published_at ? new Date(p.published_at) : now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticRoutes, ...postRoutes];
}
