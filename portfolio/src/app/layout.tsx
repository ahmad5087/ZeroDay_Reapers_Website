import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

// Canonical public URL of the portfolio — it's served at /portfolio on the apex domain, NOT the raw
// *.vercel.app deployment. Overridable per-deploy via NEXT_PUBLIC_SITE_URL (see PHASE-13-PORTFOLIO.md).
// metadataBase must be an ORIGIN (no path) so Next doesn't double the basePath on file-based OG images.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://zerodayreapers.me/portfolio";
const ORIGIN = new URL(SITE_URL).origin;
// The card is served by app/og/route.tsx at /portfolio/og (a route handler, not the opengraph-image file
// convention — that convention drops the basePath and points og:image at the MAIN site's card). Pin it.
const OG_IMAGE = `${SITE_URL.replace(/\/$/, "")}/og`;
const OG_ALT = "Ali Raza — Cybersecurity Professional & Founder of ZeroDay Reapers";
// One description reused across meta/OG/Twitter; ≥100 chars so LinkedIn's inspector stops warning.
const DESCRIPTION =
  "Ali Raza — cybersecurity professional, ethical-hacking instructor, and founder of ZeroDay Reapers. Penetration testing, red teaming, and cloud security across AWS, Azure, and GCP.";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: "Ali Raza — ZeroDay Reapers",
  description: DESCRIPTION,
  keywords: ["Ali Raza", "cybersecurity", "penetration testing", "ethical hacking", "red team", "ZeroDay Reapers"],
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "Ali Raza — ZeroDay Reapers",
    description: DESCRIPTION,
    type: "profile",
    siteName: "Ali Raza",
    url: SITE_URL,
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_ALT }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ali Raza — ZeroDay Reapers",
    description: DESCRIPTION,
    images: [OG_IMAGE],
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="no-scrollbar antialiased">
      <body className={`${inter.variable} font-sans`}>
        {children}
      </body>
    </html>
  );
}
