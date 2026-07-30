import "./globals.css";
import "flag-icons/css/flag-icons.min.css";
import { Inter, JetBrains_Mono } from "next/font/google";
import IdleGuard from "./_components/IdleGuard";
import SessionRevokeGuard from "./_components/SessionRevokeGuard";

// Modern sans for body + JetBrains Mono for accents/headings. Self-hosted by next/font.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", display: "swap" });

export const metadata = {
  title: "ZeroDay Reapers — Offensive Cybersecurity",
  description:
    "Penetration testing, red teaming, vulnerability assessment, cloud security, and cybersecurity training by ZeroDay Reapers.",
  metadataBase: new URL("https://zerodayreapers.me"),
  openGraph: {
    title: "ZeroDay Reapers",
    description: "Offensive cybersecurity services and training.",
    url: "https://zerodayreapers.me",
    siteName: "ZeroDay Reapers",
    images: ["/logo.png"],
    type: "website",
  },
  icons: { icon: "/logo.png" },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${jbmono.variable}`}>
      <body className="font-sans">{children}<IdleGuard /><SessionRevokeGuard /></body>
    </html>
  );
}
