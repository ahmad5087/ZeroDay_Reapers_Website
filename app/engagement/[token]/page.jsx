import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";

// Token-gated client engagement view (Phase 8, #9). No login: reads via the anon `get_engagement`
// RPC using the secret token in the URL. Not indexed / not cached (private per-token content).
export const dynamic = "force-dynamic";
export const metadata = { title: "Engagement — ZeroDay Reapers", robots: { index: false, follow: false } };

const STEPS = ["new", "triage", "scoping", "proposal", "active", "closed"];
const STEP_LABEL = { new: "Received", triage: "Triage", scoping: "Scoping", proposal: "Proposal", active: "Active", closed: "Closed" };

async function getEngagement(token) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return null;
    const sb = createClient(url, anon, { auth: { persistSession: false } });
    const { data } = await sb.rpc("get_engagement", { p_token: token });
    return data || null;
  } catch { return null; }
}

export default async function EngagementPage({ params }) {
  const { token } = await params;
  const e = await getEngagement(token);
  if (!e) notFound();

  const stepIndex = STEPS.indexOf(e.status);
  const wrap = { maxWidth: 720, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, Segoe UI, Arial, sans-serif", color: "#111" };

  return (
    <main style={wrap}>
      <p style={{ color: "#888", fontSize: 13, textTransform: "uppercase", letterSpacing: 1 }}>Engagement</p>
      <h1 style={{ margin: "4px 0 4px" }}>{e.title}</h1>
      <p style={{ color: "#666" }}>{[e.org, e.name].filter(Boolean).join(" · ")}</p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "24px 0" }}>
        {STEPS.map((s, i) => (
          <span key={s} style={{
            fontSize: 12, padding: "6px 10px", borderRadius: 20, border: "1px solid",
            borderColor: i <= stepIndex ? "#e10600" : "#ddd",
            background: i <= stepIndex ? "#e10600" : "#fff", color: i <= stepIndex ? "#fff" : "#999",
          }}>{STEP_LABEL[s]}</span>
        ))}
      </div>

      {e.proposal_status && e.proposal_status !== "none" && (
        <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 1, color: "#888" }}>Proposal</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>
            {e.proposal_status}{e.proposal_amount != null ? ` · $${e.proposal_amount}` : ""}
          </div>
          {e.proposal_note && <p style={{ color: "#555", marginTop: 6 }}>{e.proposal_note}</p>}
        </div>
      )}

      <h2 style={{ fontSize: 16, borderBottom: "2px solid #e10600", paddingBottom: 6 }}>Updates</h2>
      {Array.isArray(e.updates) && e.updates.length > 0 ? (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14, marginTop: 16 }}>
          {e.updates.map((u, i) => (
            <li key={i} style={{ borderLeft: "3px solid #eee", paddingLeft: 12 }}>
              <div style={{ fontSize: 12, color: "#999" }}>{u.created_at ? new Date(u.created_at).toLocaleString() : ""}</div>
              {u.body && <p style={{ margin: "4px 0" }}>{u.body}</p>}
              {u.link && <a href={u.link} target="_blank" rel="noopener noreferrer" style={{ color: "#e10600", fontSize: 14 }}>Open document ↗</a>}
            </li>
          ))}
        </ul>
      ) : <p style={{ color: "#888", marginTop: 16 }}>No updates yet — we'll post here as your engagement progresses.</p>}
    </main>
  );
}
