import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL("https://zerodayreapers.me"),
  title: "Ali Raza — ZeroDay Reapers",
  description: "Ali Raza — Cybersecurity Professional & Ethical Hacking Instructor. Founder of ZeroDay Reapers.",
  keywords: ["Ali Raza", "cybersecurity", "penetration testing", "ethical hacking", "red team", "ZeroDay Reapers"],
  openGraph: {
    title: "Ali Raza — ZeroDay Reapers",
    description: "Cybersecurity professional, ethical-hacking instructor, and founder of ZeroDay Reapers.",
    type: "profile",
    siteName: "Ali Raza",
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
