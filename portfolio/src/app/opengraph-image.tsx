import { ImageResponse } from "next/og";

// Branded social share card for the portfolio (Phase 13 — SEO). Self-contained, 1200×630.
export const alt = "Ali Raza — Cybersecurity Professional & Founder of ZeroDay Reapers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background: "#050505",
          backgroundImage: "radial-gradient(1000px 500px at 85% -10%, rgba(225,6,0,0.30), transparent 60%)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 26, letterSpacing: 8, textTransform: "uppercase", color: "#ff5049", fontWeight: 700 }}>
          <div style={{ width: 44, height: 6, background: "#e10600", marginRight: 20 }} />
          Cybersecurity
        </div>
        <div style={{ display: "flex", fontSize: 104, fontWeight: 800, color: "#ffffff", marginTop: 24, lineHeight: 1.05 }}>
          Ali Raza
        </div>
        <div style={{ display: "flex", fontSize: 32, color: "#b9b3bd", marginTop: 24 }}>
          Ethical-hacking instructor · Founder of{" "}
          <span style={{ color: "#e10600", marginLeft: 10 }}>ZeroDay Reapers</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
