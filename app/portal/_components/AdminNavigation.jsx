"use client";

import { useEffect, useMemo, useState } from "react";

export const ADMIN_NAV_GROUPS = [
  { key: "people", label: "People", description: "Member management and oversight", ids: ["members", "interventions", "founder"] },
  { key: "learning", label: "Learning", description: "Tasks, grading, and resources", ids: ["review", "competency", "resources", "office_hours", "similarity"] },
  { key: "community", label: "Community", description: "Announcements and safety", ids: ["comms", "moderation"] },
  { key: "growth", label: "Growth & Intake", description: "Applicants, clients, and content", ids: ["opportunities", "posts", "clients", "cohort", "referrals"] },
  { key: "system", label: "System", description: "Configuration and account", ids: ["feature_flags", "profile"] },
];

function CountBadge({ count, active = false }) {
  if (!count) return null;
  return (
    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] ${active ? "bg-blood text-white" : "bg-ink-800 text-blood"}`}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function PageButton({ tab, active, onSelect, compact = false }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(tab.id)}
      aria-current={active ? "page" : undefined}
      className={`w-full flex items-center justify-between gap-3 rounded-sm text-left font-mono transition ${compact ? "px-3 py-2 text-[11px]" : "px-3 py-2.5 text-xs"} ${
        active
          ? "bg-blood/15 text-white border-l-2 border-blood"
          : "text-neutral-400 border-l-2 border-transparent hover:bg-ink-900/70 hover:text-neutral-100"
      }`}
    >
      <span>{tab.label}</span>
      <CountBadge count={tab.count} active={active} />
    </button>
  );
}

export default function AdminNavigation({ tabs, activeTab, onSelect, showHome = false, onOpenSearch }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const tabById = useMemo(() => Object.fromEntries(tabs.map((tab) => [tab.id, tab])), [tabs]);
  const groups = useMemo(() => ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    tabs: group.ids.map((id) => tabById[id]).filter(Boolean),
  })).filter((group) => group.tabs.length > 0), [tabById]);
  const currentGroup = groups.find((group) => group.ids.includes(activeTab));
  const currentPage = activeTab === "home" ? { label: "Home" } : tabById[activeTab];

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  const selectPage = (id) => {
    onSelect(id);
    setMobileOpen(false);
  };

  const homeButton = (compact = false) => showHome ? (
    <PageButton tab={{ id: "home", label: "Home", count: 0 }} active={activeTab === "home"} onSelect={selectPage} compact={compact} />
  ) : null;

  const pageGroups = (compact = false) => groups.map((group) => (
    <section key={group.key} aria-label={group.label} className="space-y-1">
      <div className="px-3 pb-1">
        <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-neutral-300">
          {group.label}
        </p>
        <p className="mt-0.5 text-[10px] text-neutral-600">{group.description}</p>
      </div>
      <div className="ml-3 border-l border-neutral-800 pl-1">
        {group.tabs.map((tab) => (
          <PageButton key={tab.id} tab={tab} active={activeTab === tab.id} onSelect={selectPage} compact={compact} />
        ))}
      </div>
    </section>
  ));

  const location = activeTab === "home"
    ? "Home"
    : `${currentGroup?.label || "Admin"} / ${currentPage?.label || "Page"}`;

  return (
    <>
      <div className="lg:hidden border-b border-blood/20 bg-black/70 px-4 py-3">
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-controls="admin-mobile-navigation"
          className="w-full flex items-center justify-between gap-4 rounded-sm border border-neutral-800 bg-ink-950/80 px-3 py-2.5 text-left"
        >
          <span className="min-w-0">
            <span className="block font-mono text-[9px] uppercase tracking-widest text-neutral-600">Current page</span>
            <span className="block truncate font-mono text-xs text-white">{location}</span>
          </span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-widest text-blood">
            {mobileOpen ? "Close" : "Browse pages"}
          </span>
        </button>

        {mobileOpen && (
          <div id="admin-mobile-navigation" className="mt-3 max-h-[65vh] space-y-4 overflow-y-auto rounded-sm border border-neutral-800 bg-ink-950 p-3">
            {homeButton(true)}
            {pageGroups(true)}
            {onOpenSearch && (
              <button type="button" onClick={() => { setMobileOpen(false); onOpenSearch(); }} className="w-full rounded-sm border border-neutral-800 px-3 py-2 text-left font-mono text-[11px] text-neutral-400 hover:border-blood hover:text-white transition">
                Search all admin pages
              </button>
            )}
          </div>
        )}
      </div>

      <aside className="hidden lg:block lg:sticky lg:top-[57px] lg:h-[calc(100vh-57px)] lg:overflow-y-auto border-r border-blood/20 bg-black/40 px-3 py-5">
        <div className="px-3 pb-4 border-b border-neutral-900">
          <p className="font-mono text-xs font-bold uppercase tracking-widest text-white">Admin pages</p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-600">Categories are labels. Select a page underneath.</p>
        </div>
        <nav aria-label="Admin pages" className="mt-4 space-y-5">
          {homeButton()}
          {pageGroups()}
        </nav>
        {onOpenSearch && (
          <button type="button" onClick={onOpenSearch} className="mt-5 w-full rounded-sm border border-neutral-800 px-3 py-2 text-left font-mono text-[10px] uppercase tracking-widest text-neutral-500 hover:border-blood hover:text-white transition">
            Search pages <span className="float-right text-neutral-700">Ctrl K</span>
          </button>
        )}
      </aside>
    </>
  );
}
