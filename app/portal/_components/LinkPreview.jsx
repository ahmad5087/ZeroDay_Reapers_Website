"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Matches http(s):// URLs and bare www.* tokens inside message text.
const URL_RE = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;

function normalizeHref(u) {
  return /^https?:\/\//i.test(u) ? u : "https://" + u;
}
// Trailing punctuation (a period ending a sentence, a closing paren, etc.) isn't part of the link.
function splitTrailing(u) {
  const m = u.match(/[).,!?;:'"\]]+$/);
  return m ? [u.slice(0, u.length - m[0].length), m[0]] : [u, ""];
}
function hostOf(u) {
  try { return new URL(normalizeHref(u)).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// The first clickable link in a message (normalized with a protocol), or null.
export function firstLink(text = "") {
  const m = text.match(new RegExp(URL_RE.source, "i"));
  if (!m) return null;
  return normalizeHref(splitTrailing(m[0])[0]);
}

// Highlight "@Name"/"@all" mention tokens within a plain-text run (mirrors the chat styling).
function highlightMentions(text, names, myName, keyPrefix) {
  if (!text) return [];
  const escaped = (names || []).filter(Boolean).sort((a, b) => b.length - a.length)
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp("@(" + ["all\\b", ...escaped].join("|") + ")", "gi");
  const nodes = [];
  let last = 0, m, k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[1].toLowerCase();
    const isMe = tok === "all" || (myName && tok === myName.toLowerCase());
    nodes.push(
      <span key={`${keyPrefix}m${k++}`} className={isMe ? "bg-blood/30 text-blood font-semibold px-0.5 rounded-sm" : "text-blood font-semibold"}>
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

// Render message text with clickable links + @mention highlighting. Drop-in for {content}.
export function renderMessageContent(text = "", { memberNames = [], myName = "" } = {}) {
  if (!text) return text;
  const urlRe = new RegExp(URL_RE.source, "gi");
  const nodes = [];
  let last = 0, m, k = 0;
  while ((m = urlRe.exec(text)) !== null) {
    if (m.index > last) nodes.push(...highlightMentions(text.slice(last, m.index), memberNames, myName, `t${k}`));
    const [core, trailing] = splitTrailing(m[0]);
    nodes.push(
      <a key={`u${k++}`} href={normalizeHref(core)} target="_blank" rel="noopener noreferrer nofollow"
        className="text-neon-cyan underline decoration-neon-cyan/40 hover:decoration-neon-cyan break-all">
        {core}
      </a>
    );
    if (trailing) nodes.push(trailing);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(...highlightMentions(text.slice(last), memberNames, myName, `t${k}`));
  return nodes;
}

// Sites that permit real iframe embedding — computed straight from the URL, no server call.
function youtubeId(u) {
  try {
    const url = new URL(normalizeHref(u));
    const h = url.hostname.replace(/^www\./, "");
    if (h === "youtu.be") return url.pathname.slice(1).split("/")[0] || null;
    if (h === "youtube.com" || h.endsWith(".youtube.com")) {
      if (url.pathname === "/watch") return url.searchParams.get("v");
      const m = url.pathname.match(/^\/(embed|shorts|live)\/([\w-]+)/);
      if (m) return m[2];
    }
  } catch { /* ignore */ }
  return null;
}
function vimeoId(u) {
  try {
    const url = new URL(normalizeHref(u));
    if (url.hostname.replace(/^www\./, "") === "vimeo.com") {
      const m = url.pathname.match(/\/(\d+)/);
      if (m) return m[1];
    }
  } catch { /* ignore */ }
  return null;
}

const _cache = new Map(); // url -> preview data | null (per session, avoids refetching)

// Rich preview under a message: a live player for embeddable video, else an Open Graph card.
export function LinkPreview({ url }) {
  const yt = youtubeId(url);
  const vm = vimeoId(url);
  const isVideo = Boolean(yt || vm);

  const [data, setData] = useState(() => _cache.get(url) || null);
  const [state, setState] = useState(isVideo ? "video" : (_cache.has(url) ? "done" : "loading"));

  useEffect(() => {
    if (isVideo || _cache.has(url)) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const res = await fetch("/api/link-preview?url=" + encodeURIComponent(url), {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        });
        const j = await res.json().catch(() => ({}));
        const ok = res.ok && (j.title || j.image || j.description);
        if (cancelled) return;
        _cache.set(url, ok ? j : null);
        setData(ok ? j : null);
        setState(ok ? "done" : "empty");
      } catch {
        if (!cancelled) { _cache.set(url, null); setState("empty"); }
      }
    })();
    return () => { cancelled = true; };
  }, [url, isVideo]);

  if (isVideo) {
    const src = yt ? `https://www.youtube-nocookie.com/embed/${yt}` : `https://player.vimeo.com/video/${vm}`;
    return (
      <div className="mt-2 aspect-video w-full max-w-md rounded-sm overflow-hidden border border-white/10 bg-black">
        <iframe className="w-full h-full" src={src} title="Embedded video" loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      </div>
    );
  }

  if (state === "loading") {
    return <div className="mt-2 h-16 w-full max-w-md rounded-sm border border-white/10 bg-white/5 animate-pulse" />;
  }
  if (!data) return null;

  return (
    <a href={data.url || url} target="_blank" rel="noopener noreferrer nofollow"
      className="mt-2 flex w-full max-w-md rounded-sm overflow-hidden border border-white/10 bg-black/30 hover:border-neon-cyan/40 transition">
      {data.image && (
        <img src={data.image} alt="" loading="lazy" className="h-20 w-20 md:h-24 md:w-24 object-cover shrink-0 bg-white/5" />
      )}
      <div className="p-3 min-w-0 flex flex-col justify-center">
        <div className="font-mono text-[10px] uppercase tracking-widest text-neutral-500 truncate">{data.siteName || hostOf(url)}</div>
        {data.title && <div className="text-sm text-neutral-200 font-medium line-clamp-1 mt-0.5">{data.title}</div>}
        {data.description && <div className="text-xs text-neutral-400 line-clamp-2 mt-0.5">{data.description}</div>}
      </div>
    </a>
  );
}
