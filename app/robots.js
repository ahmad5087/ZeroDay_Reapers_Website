// robots.txt (Phase 11 — SEO). Allow the public marketing surface; keep private / token routes out of
// crawlers (the portal, and the bearer-token engagement + passport pages). Points at the sitemap.
const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://zerodayreapers.me";

export default function robots() {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/portal", "/portal/admin", "/engagement/", "/passport/"] },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
