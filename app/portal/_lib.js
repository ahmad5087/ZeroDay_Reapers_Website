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
