import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

// Canonical public URL of the portfolio — it's served at /portfolio on the apex domain, NOT the raw
// *.vercel.app deployment. Overridable per-deploy via NEXT_PUBLIC_SITE_URL (see PHASE-13-PORTFOLIO.md).
// metadataBase must be an ORIGIN (no path) so Next doesn't double the basePath on file-based OG images.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://zerodayreapers.me/portfolio";
const ORIGIN = new URL(SITE_URL).origin;

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: "Ali Raza — ZeroDay Reapers",
  description: "Ali Raza — Cybersecurity Professional & Ethical Hacking Instructor. Founder of ZeroDay Reapers.",
  keywords: ["Ali Raza", "cybersecurity", "penetration testing", "ethical hacking", "red team", "ZeroDay Reapers"],
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "Ali Raza — ZeroDay Reapers",
    description: "Cybersecurity professional, ethical-hacking instructor, and founder of ZeroDay Reapers.",
    type: "profile",
    siteName: "Ali Raza",
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "Ali Raza — ZeroDay Reapers",
    description: "Cybersecurity professional & founder of ZeroDay Reapers.",
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
