"use client";

import dynamic from "next/dynamic";

// Heavy emoji dataset — load it only when a picker actually opens.
const EmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });

// Flatten [{user_id, emoji}] → [{emoji, count, mine}] for rendering chips.
export function groupReactions(list = [], meId) {
  const map = new Map();
  for (const r of list) {
    const g = map.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false };
    g.count += 1;
    if (r.user_id === meId) g.mine = true;
    map.set(r.emoji, g);
  }
  return [...map.values()];
}

// Reaction chips under a message + the emoji picker popover (when opened from the hover toolbar).
export function ReactionRow({ messageId, reactions = [], meId, onToggle, pickerOpen, onClosePicker }) {
  const groups = groupReactions(reactions, meId);
  if (groups.length === 0 && !pickerOpen) return null;
  return (
    <div className="relative mt-1 flex flex-wrap items-center gap-1">
      {groups.map((g) => (
        <button
          key={g.emoji}
          onClick={() => onToggle(messageId, g.emoji)}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${g.mine ? "border-blood bg-blood/20 text-white" : "border-neutral-700 text-neutral-300 hover:border-blood"}`}
          title={g.mine ? "Remove your reaction" : "React"}
        >
          <span>{g.emoji}</span>
          <span className="font-mono text-[10px]">{g.count}</span>
        </button>
      ))}
      {pickerOpen && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/40" onClick={onClosePicker} />
          <div className="fixed left-1/2 top-1/2 z-[61] -translate-x-1/2 -translate-y-1/2 shadow-2xl">
            <EmojiPicker
              theme="dark"
              emojiStyle="native"
              lazyLoadEmojis
              width={300}
              height={400}
              previewConfig={{ showPreview: false }}
              onEmojiClick={(e) => { onToggle(messageId, e.emoji); onClosePicker(); }}
            />
          </div>
        </>
      )}
    </div>
  );
}

// Quoted preview shown above a reply message (click to jump to the original).
export function ReplyQuote({ authorName, content, onJump }) {
  return (
    <button
      onClick={onJump}
      className="mb-1 flex max-w-full items-center gap-1.5 rounded-sm border-l-2 border-blood/60 bg-ink-900/60 px-2 py-1 text-left hover:bg-white/5 transition"
    >
      <span className="font-mono text-[10px] text-blood shrink-0">↩ {authorName || "reply"}</span>
      <span className="truncate text-[11px] text-neutral-400">{content || "message"}</span>
    </button>
  );
}

// Banner above the composer while replying.
export function ReplyBanner({ authorName, content, onCancel }) {
  return (
    <div className="mb-2 flex items-center gap-2 rounded-sm border-l-2 border-blood bg-ink-900/70 px-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-widest text-blood">Replying to {authorName || "message"}</div>
        <div className="truncate text-[11px] text-neutral-400">{content || ""}</div>
      </div>
      <button onClick={onCancel} className="font-mono text-xs text-neutral-500 hover:text-blood shrink-0">✕</button>
    </div>
  );
}
