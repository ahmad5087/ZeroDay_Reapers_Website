import { ImageResponse } from "next/og";
import certificates from "@/data/certificates.json";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "ZeroDay Reapers — Certificate Verification";

// Dynamic social-share card for /verify/[id]. Shows the holder + status when the
// certificate ID resolves, otherwise a "not found" card.
export default async function Image({ params }) {
  const { id: raw } = await params;
  const id = (raw || "").toUpperCase();
  const cert = certificates[id];
  const BLOOD = "#e10600";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          background: "#050505", color: "#e5e5e5", padding: 64,
          fontFamily: "monospace", position: "relative",
        }}
      >
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 8, background: BLOOD }} />
        <div style={{ display: "flex", alignItems: "center", letterSpacing: 6, fontSize: 30, color: "#fff" }}>
          ZERO<span style={{ color: BLOOD }}>DAY</span>&nbsp;REAPERS
        </div>

        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center" }}>
          {cert ? (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignSelf: "flex-start", alignItems: "center", gap: 12, color: "#34d399", border: "2px solid #34d39966", borderRadius: 6, padding: "8px 18px", fontSize: 22, letterSpacing: 4 }}>
                VERIFIED · AUTHENTIC
              </div>
              <div style={{ display: "flex", fontSize: 72, color: "#fff", marginTop: 28 }}>{cert.name}</div>
              <div style={{ display: "flex", fontSize: 30, color: "#a3a3a3", marginTop: 12 }}>
                {cert.type} · {cert.department}
              </div>
              <div style={{ display: "flex", fontSize: 26, color: BLOOD, marginTop: 24, letterSpacing: 3 }}>{id}</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignSelf: "flex-start", alignItems: "center", color: BLOOD, border: `2px solid ${BLOOD}66`, borderRadius: 6, padding: "8px 18px", fontSize: 22, letterSpacing: 4 }}>
                CERTIFICATE NOT FOUND
              </div>
              <div style={{ display: "flex", fontSize: 60, color: "#fff", marginTop: 28, letterSpacing: 3 }}>{id || "UNKNOWN ID"}</div>
              <div style={{ display: "flex", fontSize: 26, color: "#a3a3a3", marginTop: 16 }}>
                No matching credential in the ZeroDay Reapers registry.
              </div>
            </div>
          )}
        </div>

        <div style={{ display: "flex", fontSize: 22, color: "#737373" }}>zerodayreapers.me/verify</div>
      </div>
    ),
    { ...size }
  );
}
