import "./globals.css";
import "flag-icons/css/flag-icons.min.css";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import IdleGuard from "./_components/IdleGuard";
import SessionRevokeGuard from "./_components/SessionRevokeGuard";
import PWARegister from "./_components/PWARegister";
import RefCapture from "./_components/RefCapture";
import ErrorBoundary from "./_components/ErrorBoundary";
import { Analytics } from "@vercel/analytics/next";

// Modern sans for body + JetBrains Mono for accents/headings. Self-hosted by next/font.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", display: "swap" });
const umamiScriptUrl = process.env.NEXT_PUBLIC_UMAMI_SCRIPT_URL;
const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

export const metadata = {
  title: "ZeroDay Reapers — Offensive Cybersecurity",
  description:
    "Penetration testing, red teaming, vulnerability assessment, cloud security, and cybersecurity training by ZeroDay Reapers.",
  metadataBase: new URL("https://zerodayreapers.me"),
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "ZDR Portal",
    statusBarStyle: "black-translucent",
  },
  openGraph: {
    title: "ZeroDay Reapers",
    description: "Offensive cybersecurity services and training.",
    url: "https://zerodayreapers.me",
    siteName: "ZeroDay Reapers",
    images: ["/logo.png"],
    type: "website",
  },
  icons: { icon: "/logo.png" },
  other: { "google-adsense-account": "ca-pub-4661416076527631" },
};

export const viewport = {
  themeColor: "#e10600",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${jbmono.variable}`}>
      <body className="font-sans">
        {/* Accessibility (Phase 17): keyboard users can jump past the chrome straight to the page content. */}
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:bg-blood focus:text-white focus:px-4 focus:py-2 focus:rounded-sm">Skip to content</a>
        <ErrorBoundary><div id="main-content">{children}</div></ErrorBoundary>
        <IdleGuard />
        <SessionRevokeGuard />
        <PWARegister />
        <RefCapture />
        <Analytics />{/* Vercel Web Analytics (Phase 11) — same-origin, privacy-friendly, cookieless */}
        {umamiScriptUrl && umamiWebsiteId ? (
          <Script
            id="umami-analytics"
            src={umamiScriptUrl}
            data-website-id={umamiWebsiteId}
            strategy="afterInteractive"
          />
        ) : null}
        <Script
          id="google-adsense"
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4661416076527631"
          crossOrigin="anonymous"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
