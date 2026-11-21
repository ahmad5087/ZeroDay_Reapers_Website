"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

// Cohort 2 applications admin (Phase 12). Lists waitlist rows (source="cohort-2") with full applicant
// detail and an Accept/Reject action per row. Deciding calls /api/apply/decision, which records the
// decision AND emails the applicant (acceptance or rejection). Admin-only reads/updates are enforced by
// the `waitlist_admin` RLS policy; this component just drives the workflow.

const FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "accepted", label: "Accepted" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];

const TONE = { pending: "text-amber-400", accepted: "text-[#34d399]", rejected: "text-blood" };

function fmt(ts) {
  if (!ts) return "—";
  try { return new Date(ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }); } catch { return "—"; }
}

// Build a CSV client-side and trigger a download. The leading ﻿ (BOM) makes Excel read UTF-8, and
// any cell starting with = + - @ is prefixed with ' to block spreadsheet formula injection from
// applicant-controlled values (name, email, LinkedIn).
function downloadCsv(filename, headers, rows) {
  const esc = (value) => {
    const text = String(value ?? "");
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [headers, ...rows].map((row) => row.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Trigger a browser download for a generated Blob (used by the PDF/Word exports).
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Shared export schema so CSV, PDF and Word stay identical. phone keeps its country code verbatim.
const EXPORT_HEADERS = ["Full name", "Email", "LinkedIn", "Phone (with country code)", "Applied", "Decision"];
function buildExportRows(rows) {
  return rows.map((r) => [
    r.name || "",
    r.email || "",
    r.linkedin_url || "",
    r.phone || "",
    fmt(r.created_at),
    r.decision || "pending",
  ]);
}

function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">{label}</div>
      <div className="text-sm text-neutral-200 break-words">{children || "—"}</div>
    </div>
  );
}

export default function CohortApplicationsAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("pending");
  const [busyId, setBusyId] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [exporting, setExporting] = useState(null); // null | "pdf" | "docx" while a file is generating

  async function load() {
    setLoading(true); setErr("");
    const { data, error } = await supabase
      .from("waitlist").select("*").eq("source", "cohort-2")
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) return setErr("Couldn't load applications: " + error.message);
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  const counts = useMemo(() => {
    const c = { pending: 0, accepted: 0, rejected: 0, all: rows.length };
    for (const r of rows) c[r.decision || "pending"] = (c[r.decision || "pending"] || 0) + 1;
    return c;
  }, [rows]);

  const shown = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => (r.decision || "pending") === filter)),
    [rows, filter]
  );

  async function decide(row, decision) {
    setErr(""); setOk(""); setBusyId(row.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/apply/decision", {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, decision }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || "Decision failed."); setBusyId(null); return; }
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, decision, decided_at: new Date().toISOString() } : r)));
      setOk(`${decision === "accepted" ? "Accepted" : "Rejected"} ${row.name || row.email}${j.emailed ? " — email sent." : " (saved, but email not sent — check Resend config)."}`);
    } catch {
      setErr("Network error — try again.");
    }
    setBusyId(null);
  }

  // Export EVERY cohort-2 application (not just the active filter) as a CSV. phone is stored with its
  // country code (validated "+<code>…" on apply), so it exports verbatim.
  function exportCsv() {
    if (!rows.length) { setErr("No applications to export yet."); return; }
    setErr(""); setOk("");
    const data = buildExportRows(rows);
    downloadCsv(`cohort-2-applications-${new Date().toISOString().slice(0, 10)}.csv`, EXPORT_HEADERS, data);
    setOk(`Downloaded ${data.length} application${data.length === 1 ? "" : "s"} as CSV.`);
  }

  // Export every cohort-2 application as a landscape PDF table. jspdf + autotable are loaded on demand
  // (dynamic import) so they stay out of the main bundle and only download when an admin clicks Export.
  async function exportPdf() {
    if (!rows.length) { setErr("No applications to export yet."); return; }
    setErr(""); setOk(""); setExporting("pdf");
    try {
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const today = new Date().toISOString().slice(0, 10);
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      doc.setFontSize(15);
      doc.text("ZeroDay Reapers — Cohort 2 Applications", 40, 42);
      doc.setFontSize(10);
      doc.setTextColor(120);
      doc.text(`Exported ${today} · ${rows.length} application${rows.length === 1 ? "" : "s"}`, 40, 60);
      autoTable(doc, {
        startY: 76,
        head: [EXPORT_HEADERS],
        body: buildExportRows(rows),
        margin: { left: 40, right: 40 },
        styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak", valign: "middle" },
        headStyles: { fillColor: [190, 18, 60], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [244, 244, 245] },
        columnStyles: { 0: { cellWidth: 110 }, 1: { cellWidth: 150 }, 2: { cellWidth: 170 } },
      });
      doc.save(`cohort-2-applications-${today}.pdf`);
      setOk(`Downloaded ${rows.length} application${rows.length === 1 ? "" : "s"} as PDF.`);
    } catch (e) {
      setErr("PDF export failed: " + (e?.message || "unknown error"));
    } finally {
      setExporting(null);
    }
  }

  // Export every cohort-2 application as a real Word .docx table. docx is loaded on demand. Column widths
  // use DXA (not PERCENTAGE, which breaks in Google Docs) and sum to 9000 (fits A4 and Letter portrait).
  async function exportDocx() {
    if (!rows.length) { setErr("No applications to export yet."); return; }
    setErr(""); setOk(""); setExporting("docx");
    try {
      const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, WidthType, HeadingLevel, ShadingType } =
        await import("docx");
      const today = new Date().toISOString().slice(0, 10);
      const COLW = [1450, 2050, 2050, 1350, 1350, 750]; // DXA, sum = 9000
      const headerRow = new TableRow({
        tableHeader: true,
        children: EXPORT_HEADERS.map((h, i) => new TableCell({
          width: { size: COLW[i], type: WidthType.DXA },
          shading: { type: ShadingType.CLEAR, color: "auto", fill: "BE123C" },
          children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, color: "FFFFFF", size: 16 })] })],
        })),
      });
      const bodyRows = buildExportRows(rows).map((cells) => new TableRow({
        children: cells.map((c, i) => new TableCell({
          width: { size: COLW[i], type: WidthType.DXA },
          children: [new Paragraph({ children: [new TextRun({ text: String(c ?? ""), size: 16 })] })],
        })),
      }));
      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("ZeroDay Reapers — Cohort 2 Applications")] }),
            new Paragraph({ children: [new TextRun({ text: `Exported ${today} · ${rows.length} application${rows.length === 1 ? "" : "s"}`, italics: true, color: "777777", size: 16 })] }),
            new Paragraph({ children: [] }),
            new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: COLW, rows: [headerRow, ...bodyRows] }),
          ],
        }],
      });
      const blob = await Packer.toBlob(doc);
      triggerDownload(blob, `cohort-2-applications-${today}.docx`);
      setOk(`Downloaded ${rows.length} application${rows.length === 1 ? "" : "s"} as Word (.docx).`);
    } catch (e) {
      setErr("Word export failed: " + (e?.message || "unknown error"));
    } finally {
      setExporting(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-mono text-lg text-white">Cohort 2 · Applications</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[10px] uppercase tracking-widest text-neutral-500">Export</span>
          <button onClick={exportCsv} disabled={loading || !rows.length || !!exporting} className="font-mono text-[11px] uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1.5 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition disabled:opacity-40 disabled:pointer-events-none">
            ⬇ CSV
          </button>
          <button onClick={exportPdf} disabled={loading || !rows.length || !!exporting} className="font-mono text-[11px] uppercase tracking-widest border border-blood text-blood px-3 py-1.5 rounded-sm hover:bg-blood hover:text-ink-950 transition disabled:opacity-40 disabled:pointer-events-none">
            {exporting === "pdf" ? "…" : "⬇ PDF"}
          </button>
          <button onClick={exportDocx} disabled={loading || !rows.length || !!exporting} className="font-mono text-[11px] uppercase tracking-widest border border-sky-400 text-sky-400 px-3 py-1.5 rounded-sm hover:bg-sky-400 hover:text-ink-950 transition disabled:opacity-40 disabled:pointer-events-none">
            {exporting === "docx" ? "…" : "⬇ Word"}
          </button>
          <button onClick={load} className="font-mono text-[11px] uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-1.5 rounded-sm hover:border-blood hover:text-blood transition">
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`font-mono text-[11px] uppercase tracking-widest border px-3 py-1.5 rounded-sm transition inline-flex items-center gap-2 ${
              filter === f.key ? "border-blood bg-blood/15 text-white" : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
            }`}
          >
            {f.label}
            <span className={`rounded-sm px-1.5 py-0.5 text-[10px] ${filter === f.key ? "bg-blood text-white" : "bg-ink-800 text-blood"}`}>{counts[f.key] || 0}</span>
          </button>
        ))}
      </div>

      {err && <p className="text-blood text-sm">{err}</p>}
      {ok && <p className="text-[#34d399] text-sm">{ok}</p>}

      {loading ? (
        <p className="font-mono text-xs text-neutral-500">Loading…</p>
      ) : shown.length === 0 ? (
        <p className="text-neutral-500 text-sm">No {filter === "all" ? "" : filter} applications.</p>
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => {
            const decision = r.decision || "pending";
            const open = openId === r.id;
            const busy = busyId === r.id;
            return (
              <li key={r.id} className="panel border border-blood/20 rounded-xl overflow-hidden">
                {/* Summary row */}
                <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
                  <button onClick={() => setOpenId(open ? null : r.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-white font-medium truncate">{r.name || "—"}</span>
                      <span className="text-neutral-500 text-xs">·</span>
                      <span className="text-neutral-300 text-sm truncate">{r.domain || "—"}</span>
                      <span className={`font-mono text-[10px] uppercase tracking-widest ${TONE[decision]}`}>● {decision}</span>
                    </div>
                    <div className="text-neutral-500 text-xs mt-0.5 truncate">{r.email} · applied {fmt(r.created_at)}</div>
                  </button>
                  <div className="flex gap-2">
                    <button
                      disabled={busy || decision === "accepted"}
                      onClick={() => decide(r, "accepted")}
                      className="text-xs uppercase tracking-widest border border-[#34d399] text-[#34d399] px-3 py-1 rounded-sm hover:bg-[#34d399] hover:text-ink-950 transition disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {busy ? "…" : "Accept"}
                    </button>
                    <button
                      disabled={busy || decision === "rejected"}
                      onClick={() => decide(r, "rejected")}
                      className="text-xs uppercase tracking-widest border border-blood text-blood px-3 py-1 rounded-sm hover:bg-blood hover:text-ink-950 transition disabled:opacity-40 disabled:pointer-events-none"
                    >
                      {busy ? "…" : "Reject"}
                    </button>
                  </div>
                </div>

                {/* Detail */}
                {open && (
                  <div className="border-t border-blood/10 bg-black/30 px-4 py-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    <Detail label="Full name">{r.name}</Detail>
                    <Detail label="Email"><a href={`mailto:${r.email}`} className="text-blood hover:underline">{r.email}</a></Detail>
                    <Detail label="WhatsApp">{r.phone}</Detail>
                    <Detail label="Location">{[r.city, r.country].filter(Boolean).join(", ")}</Detail>
                    <Detail label="Domain">{r.domain}</Detail>
                    <Detail label="Experience">{r.experience}</Detail>
                    <Detail label="RAM">{r.ram ? `${r.ram} GB` : "—"}</Detail>
                    <Detail label="Gender">{r.gender}</Detail>
                    <Detail label="Status">
                      {r.current_status === "Student"
                        ? `Student — ${r.college || "—"}${r.study_year ? ` (${r.study_year})` : ""}`
                        : r.current_status}
                    </Detail>
                    <Detail label="LinkedIn">
                      {r.linkedin_url ? <a href={r.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blood hover:underline break-all">{r.linkedin_url}</a> : "—"}
                    </Detail>
                    <Detail label="Referred by (code)">{r.referral_code}</Detail>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <Detail label="Motivation"><span className="whitespace-pre-wrap">{r.motivation}</span></Detail>
                    </div>
                    {decision !== "pending" && (
                      <div className="sm:col-span-2 lg:col-span-3 text-neutral-500 text-xs font-mono">
                        {decision === "accepted" ? "Accepted" : "Rejected"} · {fmt(r.decided_at)}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
