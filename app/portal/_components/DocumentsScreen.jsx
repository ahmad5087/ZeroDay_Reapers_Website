"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { uploadToR2, downloadFromR2, deleteFromR2 } from "@/lib/r2client";

export default function DocumentsScreen({ me, onBack }) {
  const [docs, setDocs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data } = await supabase.from("documents").select("*").eq("user_id", me.id).order("created_at", { ascending: false });
    setDocs(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function upload(kind, file) {
    if (!file) return;
    setErr(""); setOk(""); setBusy(true);
    try {
      const { key, name } = await uploadToR2(file, { kind });
      // one resume per user: replace the existing resume row if present
      if (kind === "resume") {
        const existing = docs.find((d) => d.kind === "resume");
        if (existing) await supabase.from("documents").update({ file_key: key, file_name: name }).eq("id", existing.id);
        else await supabase.from("documents").insert({ user_id: me.id, kind, file_key: key, file_name: name });
      } else {
        await supabase.from("documents").insert({ user_id: me.id, kind: "other", file_key: key, file_name: name });
      }
      load();
      setOk("Upload successful ✓");
      setTimeout(() => setOk(""), 4000);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(doc) {
    setErr("");
    try {
      await deleteFromR2(doc.file_key);
      await supabase.from("documents").delete().eq("id", doc.id);
      load();
    } catch (e) { setErr(e.message); }
  }

  const resume = docs.find((d) => d.kind === "resume");
  const others = docs.filter((d) => d.kind === "other");

  const uploadBtn = "cursor-pointer font-mono text-xs uppercase tracking-widest btn-neon px-4 py-2 rounded-sm hover:bg-blood-glow transition";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 bg-black/60 backdrop-blur-xl border-b border-blood/25">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
          <span className="font-mono text-sm tracking-widest text-white text-glow">MY DOCUMENTS</span>
          <button onClick={onBack} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-3 py-2 rounded-sm hover:border-blood hover:text-blood transition">
            ← Back to chat
          </button>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-10">
        {err && <p className="font-mono text-sm text-blood">{err}</p>}
        {ok && <p className="font-mono text-sm text-[#34d399]">{ok}</p>}

        {/* Resume */}
        <section>
          <h2 className="font-mono text-xl text-white mb-4">Resume / CV</h2>
          {loading ? (
            <p className="font-mono text-xs text-neutral-500 animate-pulse">Loading…</p>
          ) : (
            <div className="flex items-center gap-3 flex-wrap border border-blood/20 rounded-sm p-4">
              <label className={uploadBtn}>
                <input type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => upload("resume", e.target.files?.[0])} disabled={busy} />
                {busy ? "Uploading…" : resume ? "Replace resume" : "Upload resume"}
              </label>
              {resume ? (
                <>
                  <button onClick={() => downloadFromR2(resume.file_key)} className="font-mono text-xs uppercase tracking-widest border border-neutral-700 text-neutral-300 px-4 py-2 rounded-sm hover:border-blood hover:text-blood transition">View</button>
                  <span className="font-mono text-xs text-neutral-500 truncate max-w-[220px]">{resume.file_name}</span>
                  <button onClick={() => remove(resume)} className="font-mono text-xs text-neutral-500 hover:text-blood ml-auto">delete</button>
                </>
              ) : (
                <span className="font-mono text-xs text-neutral-600">No resume uploaded yet.</span>
              )}
            </div>
          )}
        </section>

        {/* Other documents */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-mono text-xl text-white">Other documents</h2>
            <label className={uploadBtn}>
              <input type="file" className="hidden" onChange={(e) => upload("other", e.target.files?.[0])} disabled={busy} />
              + Add
            </label>
          </div>
          {others.length === 0 ? (
            <p className="font-mono text-xs text-neutral-600">No other documents.</p>
          ) : (
            <div className="space-y-2">
              {others.map((d) => (
                <div key={d.id} className="flex items-center gap-3 border border-blood/20 rounded-sm p-3">
                  <span className="font-mono text-sm text-white truncate">{d.file_name}</span>
                  <button onClick={() => downloadFromR2(d.file_key)} className="ml-auto font-mono text-xs uppercase tracking-widest text-blood hover:underline">view</button>
                  <button onClick={() => remove(d)} className="font-mono text-xs text-neutral-500 hover:text-blood">delete</button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
