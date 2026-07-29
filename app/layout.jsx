import "./globals.css";
import "flag-icons/css/flag-icons.min.css";
import IdleGuard from "./_components/IdleGuard";
import SessionRevokeGuard from "./_components/SessionRevokeGuard";

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
    <html lang="en">
      <body className="font-sans">{children}<IdleGuard /><SessionRevokeGuard /></body>
    </html>
  );
}
