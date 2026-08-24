import { ImageResponse } from "next/og";

// Default social share card for the marketing site (Phase 11 — SEO). Branded, self-contained (no
// external fonts/assets), 1200×630. Individual Insights posts override this with their own title card.
export const alt = "ZeroDay Reapers — offensive-security internship & agency";
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
          background: "#0b0a0d",
          backgroundImage:
            "radial-gradient(1000px 500px at 85% -10%, rgba(225,6,0,0.28), transparent 60%)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 26,
            letterSpacing: 8,
            textTransform: "uppercase",
            color: "#ff5049",
            fontWeight: 700,
          }}
        >
          <div style={{ width: 44, height: 6, background: "#e10600", marginRight: 20 }} />
          Offensive Security
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 108,
            fontWeight: 800,
            color: "#ffffff",
            marginTop: 24,
            lineHeight: 1.05,
          }}
        >
          ZeroDay&nbsp;<span style={{ color: "#e10600" }}>Reapers</span>
        </div>
        <div style={{ display: "flex", fontSize: 34, color: "#b9b3bd", marginTop: 26 }}>
          Internship program &amp; security agency
        </div>
      </div>
    ),
    { ...size }
  );
}
