// Portal-only shell: applies the cyberpunk/neon theme (animated grid + neon glows + sans body)
// to everything under /portal. The marketing site (app/page.jsx) is intentionally NOT wrapped,
// so its look is unchanged. Individual portal screens can go transparent to reveal this backdrop.
export default function PortalLayout({ children }) {
  return <div className="portal-shell">{children}</div>;
}
