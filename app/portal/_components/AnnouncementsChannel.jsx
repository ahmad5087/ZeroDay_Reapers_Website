"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { renderMessageContent, firstLink, LinkPreview } from "./LinkPreview";

const EMOJIS = ["👍", "❤️", "🔥", "🎉", "👀"];

export default function AnnouncementsChannel({ me }) {
  const isAdmin = me.role === "admin";
  const [items, setItems] = useState([]);
  const [reactions, setReactions] = useState([]); // {announcement_id,user_id,emoji}
  const [form, setForm] = useState({ title: "", body: "" });
  const [err, setErr] = useState("");

  async function loadAll() {
    const { data: anns } = await supabase.from("announcements").select("*").order("is_pinned", { ascending: false }).order("created_at", { ascending: false });
    setItems(anns || []);
    const { data: rx } = await supabase.from("announcement_reactions").select("announcement_id,user_id,emoji");
    setReactions(rx || []);
  }

  async function togglePin(a) {
    await supabase.from("announcements").update({ is_pinned: !a.is_pinned, pinned_at: !a.is_pinned ? new Date().toISOString() : null }).eq("id", a.id);
    loadAll();
  }

  useEffect(() => {
    loadAll();
    const ch = supabase.channel("announcements-feed")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" },
        ({ new: a }) => setItems((p) => {
          const next = p.some((x) => x.id === a.id) ? p : [a, ...p];
          return [...next].sort((x, y) => (y.is_pinned ? 1 : 0) - (x.is_pinned ? 1 : 0) || new Date(y.created_at) - new Date(x.created_at));
        }))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "announcements" },
        ({ new: a }) => setItems((p) => {
          const next = p.map((x) => x.id === a.id ? { ...x, ...a } : x);
          return [...next].sort((x, y) => (y.is_pinned ? 1 : 0) - (x.is_pinned ? 1 : 0) || new Date(y.created_at) - new Date(x.created_at));
        }))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "announcements" },
        ({ old: a }) => setItems((p) => p.filter((x) => x.id !== a.id)))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcement_reactions" },
        ({ new: r }) => setReactions((p) => p.some((x) => x.announcement_id === r.announcement_id && x.user_id === r.user_id && x.emoji === r.emoji) ? p : [...p, r]))
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "announcement_reactions" },
        ({ old: r }) => setReactions((p) => p.filter((x) => !(x.announcement_id === r.announcement_id && x.user_id === r.user_id && x.emoji === r.emoji))))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  async function toggleReaction(annId, emoji) {
    setErr("");
    const mine = reactions.find((r) => r.announcement_id === annId && r.user_id === me.id && r.emoji === emoji);
    if (mine) {
      setReactions((p) => p.filter((x) => x !== mine)); // optimistic
      await supabase.from("announcement_reactions").delete()
        .match({ announcement_id: annId, user_id: me.id, emoji });
    } else {
      const row = { announcement_id: annId, user_id: me.id, emoji };
      setReactions((p) => [...p, row]); // optimistic
      const { error } = await supabase.from("announcement_reactions").insert(row);
      if (error) setReactions((p) => p.filter((x) => x !== row));
    }
  }

  async function post(e) {
    e.preventDefault();
    setErr("");
    if (!form.title.trim() || !form.body.trim()) return;
    const { error } = await supabase.from("announcements").insert({ title: form.title.trim(), body: form.body.trim() });
    if (error) return setErr(error.message);
    setForm({ title: "", body: "" });
  }

  async function remove(id) {
    await supabase.from("announcements").delete().eq("id", id);
  }

  const input = "w-full panel border border-blood/30 focus:border-blood outline-none px-4 py-3 text-neutral-100 rounded-sm font-mono text-sm";

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Admin composer (only admins can post) */}
      {isAdmin && (
        <form onSubmit={post} className="border-b border-blood/10 p-4 space-y-2">
          <input className={input} placeholder="Announcement title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <textarea className={input} rows={2} placeholder="Write an announcement…" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          <button className="btn-neon font-mono text-xs uppercase tracking-widest px-5 py-2.5 rounded-sm hover:bg-blood-glow transition">
            Post announcement
          </button>
        </form>
      )}

      {err && <p className="px-4 pt-3 font-mono text-xs text-blood">{err}</p>}

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {items.length === 0 ? (
          <p className="font-mono text-xs text-neutral-500">No announcements yet.</p>
        ) : (
          items.map((a) => (
            <article key={a.id} className="border border-blood/20 rounded-sm p-5 bg-ink-900/40">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-mono text-white text-lg">{a.title}</h3>
                <div className="flex items-center gap-3 shrink-0">
                  {a.is_pinned && (
                    <span className="font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 rounded-sm bg-amber-500 text-ink-950 font-bold flex items-center gap-1 shadow-sm">
                      📌 Pinned
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-neutral-600">{new Date(a.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                  {isAdmin && (
                    <>
                      <button onClick={() => togglePin(a)} className="font-mono uppercase text-[10px] text-amber-400 hover:underline">
                        {a.is_pinned ? "unpin" : "pin"}
                      </button>
                      <button onClick={() => remove(a.id)} className="font-mono text-[10px] text-neutral-500 hover:text-blood">delete</button>
                    </>
                  )}
                </div>
              </div>
              <p className="mt-2 text-neutral-300 whitespace-pre-wrap leading-relaxed">{renderMessageContent(a.body)}</p>
              {firstLink(a.body) && <LinkPreview url={firstLink(a.body)} />}

              {/* Reaction bar — everyone can react, nobody can reply */}
              <div className="mt-4 flex flex-wrap gap-2">
                {EMOJIS.map((emoji) => {
                  const list = reactions.filter((r) => r.announcement_id === a.id && r.emoji === emoji);
                  const mine = list.some((r) => r.user_id === me.id);
                  return (
                    <button key={emoji} onClick={() => toggleReaction(a.id, emoji)}
                      className={`font-mono text-xs px-2.5 py-1 rounded-full border transition ${mine ? "border-blood bg-blood/20 text-white" : "border-neutral-700 text-neutral-400 hover:border-blood"}`}>
                      <span className="mr-1">{emoji}</span>{list.length > 0 ? list.length : ""}
                    </button>
                  );
                })}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}
