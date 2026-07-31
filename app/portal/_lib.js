// Shared portal helpers.

// Badge colour per domain key (Tailwind arbitrary values, on-brand).
export const DOMAIN_COLORS = {
  offensive: "#e10600",
  defensive: "#3b82f6",
  cloud: "#22d3ee",
  grc: "#f59e0b",
  forensics: "#a78bfa",
  ai: "#34d399",
  lobby: "#a1a1aa",
};

export function initials(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic avatar background from a string (user id / name).
export function colorFor(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return `hsl(${h} 55% 30%)`;
}

export function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export const BANNED_REGEX = /\b(fuck|shit|bitch|asshole|cunt|dick|pussy|cock|bastard|whore|slut|nigger|faggot|retard|wank|twat|douche|jackass|motherfucker|bollocks|crap|piss|nsfw)\b/i;

export function containsAbuse(text = "") {
  return BANNED_REGEX.test(text);
}

export const LINK_REGEX = /(https?:\/\/\s*[^\s]+|www\.\s*[^\s]+|\b[a-z0-9][a-z0-9.-]*\.(com|org|net|io|ai|pk|edu|gov|co|uk|us|ca|dev|app|tech|info|tv|gg|xyz|biz|au|de|fr|jp|cn|ru|br|nl|se|es|mil|int|site|online|store|shop|blog|club|vip|live|cloud|pro)\b(\/[^\s]*)?)/i;

export function containsLink(text = "") {
  return LINK_REGEX.test(text);
}

// ---- Timezone-aware times ----
// Times are stored as UTC. The canonical/authoring zone is Pakistan Standard Time (Asia/Karachi,
// a fixed UTC+5 — Pakistan has no daylight saving). Viewers see their own local time, with the
// PKT time shown alongside for reference.
const PKT_TZ = "Asia/Karachi";

// Viewer-local date+time with a zone label, plus the PKT time — e.g.
// "Aug 1, 8:00 PM GMT+5:30 (5:00 PM PKT)".
export function fmtLocalAndPKT(ts) {
  try {
    const d = new Date(ts);
    const local = d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
    const pkt = d.toLocaleTimeString("en-US", { timeZone: PKT_TZ, hour: "2-digit", minute: "2-digit" });
    return `${local} (${pkt} PKT)`;
  } catch { return ""; }
}

// Time-only variant (for compact spots where the date is already shown) — e.g.
// "8:00 PM GMT+5:30 (5:00 PM PKT)".
export function fmtTimeLocalAndPKT(ts) {
  try {
    const d = new Date(ts);
    const local = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
    const pkt = d.toLocaleTimeString("en-US", { timeZone: PKT_TZ, hour: "2-digit", minute: "2-digit" });
    return `${local} (${pkt} PKT)`;
  } catch { return ""; }
}

// Interpret a <datetime-local> value (a naive "YYYY-MM-DDTHH:mm") as Pakistan Standard Time
// (UTC+5) and return the UTC ISO string to store — so an admin in any timezone sets PKT times.
export function pktLocalInputToISO(v) {
  if (!v) return null;
  const withSecs = v.length === 16 ? v + ":00" : v;
  const d = new Date(withSecs + "+05:00");
  return isNaN(d.getTime()) ? null : d.toISOString();
}

