import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

// Public, verifiable Digital Skill Passport (Phase 9). No login: reads via the anon
// `get_public_passport` RPC using the intern's secret token in the URL. The RPC recomputes every
// number from approved rubric marks server-side, so a shared credential can't be forged client-side.
// Not indexed (token URLs shouldn't be crawled); it's shared by link, like the 080 engagement view.
export const dynamic = "force-dynamic";
export const metadata = { title: "Skill Passport — ZeroDay Reapers", robots: { index: false, follow: false } };

async function getPassport(token) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const { data } = await sb.rpc("get_public_passport", { p_token: token });
    return data || null;
  } catch { return null; }
}

const RED = "#e10600";
const levelColor = (lvl) => (lvl === "Advanced" ? "#0a7d38" : lvl === "Proficient" ? "#b06a00" : "#666");

export default async function PassportPage({ params }) {
  const { token } = await params;
  const p = await getPassport(token);
  if (!p) notFound();

  const skills = Array.isArray(p.skills) ? p.skills : [];
  const axes = Array.isArray(p.axes) ? p.axes : [];
  const tasks = Array.isArray(p.tasks) ? p.tasks : [];
  const issued = p.issued_at ? new Date(p.issued_at).toLocaleDateString(undefined, { year: "numeric", month: "short" }) : "";

  const page = { maxWidth: 760, margin: "0 auto", padding: "40px 20px 72px", fontFamily: "system-ui, Segoe UI, Arial, sans-serif", color: "#141414" };
  const card = { border: "1px solid #e5e5e5", borderRadius: 12, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.06)" };
  const label = { fontSize: 11, letterSpacing: 2, textTransform: "uppercase", color: "#8a8a8a" };

  return (
    <main style={page}>
      {/* ---------- CREDENTIAL CARD ---------- */}
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "20px 24px", background: "#141118", color: "#fff" }}>
          <span style={{ width: 40, height: 40, flex: "none", border: `2px solid ${RED}`, borderRadius: "50%", display: "grid", placeItems: "center", color: RED, fontWeight: 800, fontSize: 18, fontFamily: "Georgia, serif" }}>Z</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12, letterSpacing: 2, textTransform: "uppercase", color: "#c7b4b4" }}>ZeroDay Reapers · Skill Passport</span>
            <span style={{ display: "block", fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{p.name}</span>
            <span style={{ display: "block", fontSize: 13, color: "#b9b3bd", marginTop: 2 }}>{[p.domain, p.member_id].filter(Boolean).join(" · ")}</span>
          </span>
          <span title="Recomputed from graded rubric marks" style={{ flex: "none", fontSize: 11, letterSpacing: 1, textTransform: "uppercase", color: "#34d399", border: "1px solid #2f7d55", borderRadius: 20, padding: "4px 10px" }}>✓ Verified</span>
        </div>

        <div style={{ padding: "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 18 }}>
            <span style={{ fontSize: 34, fontWeight: 800 }}>{p.overall_pct == null ? "—" : p.overall_pct + "%"}</span>
            <span style={{ ...label }}>overall · {p.count || 0} approved deliverable{p.count === 1 ? "" : "s"}</span>
          </div>

          {/* Per-skill "grip" */}
          <div style={label}>Skills &amp; grip</div>
          {skills.length === 0 ? (
            <p style={{ color: "#888", fontSize: 14 }}>No graded work yet.</p>
          ) : (
            <div style={{ display: "grid", gap: 12, margin: "12px 0 4px" }}>
              {skills.map((s, i) => (
                <div key={i}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 5, fontSize: 14 }}>
                    <span style={{ fontWeight: 600 }}>{s.skill} <span style={{ color: "#aaa", fontWeight: 400, fontSize: 12 }}>· {s.tasks} task{s.tasks === 1 ? "" : "s"}</span></span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: levelColor(s.level) }}>{s.level}{s.pct != null ? ` · ${s.pct}%` : ""}</span>
                  </div>
                  <div style={{ height: 8, background: "#efefef", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${s.pct || 0}%`, background: `linear-gradient(90deg, ${RED}, #ff6a63)` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Rubric competencies */}
          {axes.some((a) => a.value != null) && (
            <>
              <div style={{ ...label, marginTop: 22 }}>Competencies</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginTop: 10 }}>
                {axes.map((a, i) => (
                  <div key={i} style={{ border: "1px solid #eee", borderRadius: 8, padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, color: "#888" }}>{a.label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>{a.value == null ? "—" : a.value + " / 10"}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ---------- PASSPORT BOOKLET — a "stamp" per approved task ---------- */}
      <h2 style={{ fontSize: 15, letterSpacing: 1, textTransform: "uppercase", color: "#555", margin: "34px 0 4px" }}>Passport booklet</h2>
      <p style={{ color: "#888", fontSize: 13, margin: "0 0 16px" }}>One stamp per approved deliverable, in order.</p>
      {tasks.length === 0 ? (
        <p style={{ color: "#888", fontSize: 14 }}>Stamps appear here as deliverables are approved.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
          {tasks.map((t, i) => (
            <div key={i} style={{ border: `1px dashed ${RED}`, borderRadius: 10, padding: "12px 14px", position: "relative" }}>
              <div style={{ position: "absolute", top: 8, right: 10, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: RED, transform: "rotate(6deg)", border: `1px solid ${RED}`, borderRadius: 4, padding: "1px 5px" }}>Approved</div>
              <div style={{ fontSize: 11, color: "#999" }}>Week {t.week}</div>
              <div style={{ fontSize: 14, fontWeight: 600, margin: "3px 0 6px", lineHeight: 1.25 }}>{t.title}</div>
              <div style={{ fontSize: 12, color: "#666" }}>{t.score == null ? "—" : `${t.score} / 40`}</div>
            </div>
          ))}
        </div>
      )}

      <p style={{ color: "#9a9a9a", fontSize: 12, marginTop: 36, borderTop: "1px solid #eee", paddingTop: 14 }}>
        Issued {issued || "—"} · ZeroDay Reapers Internship · This credential is generated live from graded work and verified at this link.
      </p>
    </main>
  );
}
