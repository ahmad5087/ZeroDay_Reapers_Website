"use client";

import { useMemo, useState } from "react";

// Admin Readiness Matrix — per-intern competency from the four rubric axes on APPROVED graded
// submissions (047/051). Pure aggregation over data AdminPanel already holds (subs/members/domains);
// no new query or schema. Gated behind the `competency_matrix` feature flag by its parent.
const AXES = [
  { key: "score_completeness", label: "Complete" },
  { key: "score_accuracy",     label: "Accuracy" },
  { key: "score_evidence",     label: "Evidence" },
  { key: "score_report",       label: "Report" },
];

function tone(v10) {
  if (v10 == null) return "text-neutral-600";
  if (v10 >= 8) return "text-[#34d399]";
  if (v10 >= 6) return "text-amber-400";
  return "text-blood";
}
function nameOf(m) { return m.display_name || m.full_name || (m.member_id ? `#${m.member_id}` : "Intern"); }

export default function CompetencyMatrix({ subs = [], members = [], domains = [] }) {
  const [dept, setDept] = useState("");
  const [sortKey, setSortKey] = useState("overall");

  const rows = useMemo(() => {
    const byUser = new Map();
    for (const s of subs) {
      if (s.status !== "approved" || s.score_overall == null) continue;
      const list = byUser.get(s.user_id) || [];
      list.push(s);
      byUser.set(s.user_id, list);
    }
    const students = members.filter((m) => m.role === "student" && !m.is_alumni);
    return students.map((m) => {
      const list = byUser.get(m.id) || [];
      const avg = (key) => {
        const vals = list.map((r) => r[key]).filter((v) => v != null).map(Number);
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
      };
      const axes = Object.fromEntries(AXES.map((a) => [a.key, avg(a.key)]));
      const overallPct = list.length
        ? (list.reduce((t, r) => t + Number(r.score_overall), 0) / (list.length * 40)) * 100
        : null;
      return { m, axes, overallPct, graded: list.length };
    });
  }, [subs, members]);

  const filtered = useMemo(() => {
    let r = dept ? rows.filter((x) => String(x.m.domain_id) === String(dept)) : rows;
    return r.slice().sort((a, b) => {
      if (sortKey === "name") return nameOf(a.m).localeCompare(nameOf(b.m));
      const av = sortKey === "overall" ? a.overallPct : a.axes[sortKey];
      const bv = sortKey === "overall" ? b.overallPct : b.axes[sortKey];
      return (bv ?? -1) - (av ?? -1);
    });
  }, [rows, dept, sortKey]);

  const deptName = (id) => domains.find((d) => d.id === id)?.name || "—";
  const rated = filtered.filter((r) => r.graded > 0).length;

  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="font-mono text-xl text-white">Competency Matrix</h2>
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="panel border border-blood/30 focus:border-blood outline-none px-3 py-2 text-neutral-100 rounded-sm font-mono text-xs">
          <option value="">All departments</option>
          {domains.filter((d) => !["lobby", "alumni"].includes(d.key)).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      <p className="font-mono text-[11px] text-neutral-500 mb-3">
        Averages over each intern&apos;s approved, rubric-graded deliverables (each axis /10). {rated} of {filtered.length} shown have graded work; ungraded shows as &ldquo;—&rdquo;.
      </p>

      <div className="overflow-x-auto border border-blood/20 rounded-sm">
        <table className="w-full font-mono text-xs min-w-[640px]">
          <thead>
            <tr className="bg-ink-900/50 text-neutral-500 uppercase tracking-widest text-[10px]">
              <th className="text-left px-3 py-2 cursor-pointer hover:text-neutral-300" onClick={() => setSortKey("name")}>Intern</th>
              <th className="text-left px-3 py-2">Dept</th>
              {AXES.map((a) => (
                <th key={a.key} className="text-right px-3 py-2 cursor-pointer hover:text-neutral-300" onClick={() => setSortKey(a.key)}>{a.label}</th>
              ))}
              <th className="text-right px-3 py-2 cursor-pointer hover:text-neutral-300" onClick={() => setSortKey("overall")}>Overall</th>
              <th className="text-right px-3 py-2">Graded</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={AXES.length + 4} className="px-3 py-6 text-center text-neutral-600">No interns to show.</td></tr>
            ) : filtered.map(({ m, axes, overallPct, graded }) => (
              <tr key={m.id} className="border-t border-blood/10 hover:bg-ink-900/40">
                <td className="px-3 py-2 text-white truncate max-w-[180px]">{nameOf(m)} <span className="text-neutral-600">{m.member_id || ""}</span></td>
                <td className="px-3 py-2 text-neutral-500 truncate">{deptName(m.domain_id)}</td>
                {AXES.map((a) => (
                  <td key={a.key} className={`px-3 py-2 text-right tabular-nums ${tone(axes[a.key])}`}>{axes[a.key] == null ? "—" : axes[a.key].toFixed(1)}</td>
                ))}
                <td className={`px-3 py-2 text-right tabular-nums font-bold ${tone(overallPct == null ? null : overallPct / 10)}`}>{overallPct == null ? "—" : Math.round(overallPct) + "%"}</td>
                <td className="px-3 py-2 text-right text-neutral-500 tabular-nums">{graded}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
