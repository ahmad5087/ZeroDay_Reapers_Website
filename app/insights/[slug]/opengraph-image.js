import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

// Per-post social share card (Phase 11 — SEO): the post's title + type on the branded dark card, so a
// shared Insights link renders a proper preview. Falls back to the site name if the post can't be read.
export const alt = "ZeroDay Reapers — Insights";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TYPE_LABEL = { case_study: "Case study", research: "Research", advisory: "Advisory", success_story: "Success story" };

async function getPost(slug) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const { data } = await sb.from("posts").select("type,title").eq("slug", slug).eq("status", "published").maybeSingle();
    return data || null;
  } catch { return null; }
}

export default async function Image({ params }) {
  const { slug } = await params;
  const p = await getPost(slug);
  const kicker = (p && (TYPE_LABEL[p.type] || "Insights")) || "Insights";
  const title = (p && p.title) || "ZeroDay Reapers";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "#0b0a0d",
          backgroundImage: "radial-gradient(1000px 500px at 90% -10%, rgba(225,6,0,0.26), transparent 60%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 24, letterSpacing: 6, textTransform: "uppercase", color: "#ff5049", fontWeight: 700 }}>
          <div style={{ width: 40, height: 6, background: "#e10600", marginRight: 18 }} />
          {kicker}
        </div>
        <div style={{ display: "flex", fontSize: title.length > 60 ? 60 : 74, fontWeight: 800, color: "#ffffff", lineHeight: 1.1 }}>
          {title.length > 120 ? title.slice(0, 117) + "…" : title}
        </div>
        <div style={{ display: "flex", alignItems: "center", fontSize: 28, color: "#b9b3bd" }}>
          ZeroDay <span style={{ color: "#e10600", marginLeft: 8 }}>Reapers</span>
          <span style={{ marginLeft: 16, color: "#6b656f" }}>· Insights</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
