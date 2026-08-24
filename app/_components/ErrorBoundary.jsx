"use client";

import React from "react";

// App-wide React error boundary (Phase 15 — reliability). Catches render/runtime errors so a broken
// component shows a recoverable fallback instead of a blank white screen, and logs a structured line
// (picked up by Vercel logs / any error tracker wired later). Renders children unchanged when healthy.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(err, info) {
    try {
      console.error(JSON.stringify({
        level: "error",
        evt: "react_error_boundary",
        msg: err?.message || String(err),
        stack: (info?.componentStack || "").slice(0, 600),
        ts: new Date().toISOString(),
      }));
    } catch { /* logging is best-effort */ }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#050505", color: "#fff", fontFamily: "system-ui, Segoe UI, Arial, sans-serif", padding: 24, textAlign: "center" }}>
          <div>
            <p style={{ color: "#e10600", letterSpacing: 2, textTransform: "uppercase", fontSize: 12, margin: 0 }}>Something broke</p>
            <h1 style={{ margin: "10px 0 6px", fontSize: 26 }}>We hit an unexpected error</h1>
            <p style={{ color: "#999", margin: 0 }}>Try reloading. If it keeps happening, contact an admin.</p>
            <button
              onClick={() => { try { window.location.reload(); } catch { /* ignore */ } }}
              style={{ marginTop: 18, background: "#e10600", color: "#fff", border: 0, padding: "10px 20px", borderRadius: 6, cursor: "pointer", fontSize: 15 }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
