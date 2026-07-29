// SVG country flag (via flag-icons) — renders on every platform (Windows/Linux included),
// unlike emoji flags. `code` is an ISO 3166-1 alpha-2 country code (e.g. "PK").
// The CSS is imported once in app/layout.jsx. Renders nothing for an empty/invalid code.
export default function Flag({ code, className = "", title }) {
  const cc = (code || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 2);
  if (cc.length !== 2) return null;
  return (
    <span
      className={`fi fi-${cc} rounded-[2px] align-middle ${className}`}
      title={title || (code || "").toUpperCase()}
      aria-label={(code || "").toUpperCase()}
      role="img"
    />
  );
}
