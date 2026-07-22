import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Ali Raza — ZeroDay Reapers",
  description: "Ali Raza — Cybersecurity Professional & Ethical Hacking Instructor. Founder of ZeroDay Reapers.",
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
