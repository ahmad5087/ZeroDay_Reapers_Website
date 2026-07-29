import { useEffect, useRef, useState } from "react";

// Warns, then auto-logs-out after `timeoutMs` of inactivity. Any real user activity re-arms it.
// Returns { warning, stay }. `stay` re-arms (used by the "Stay signed in" button).
export function useIdleLogout({ enabled, timeoutMs = 600000, warnMs = 60000, onLogout }) {
  const [warning, setWarning] = useState(false);
  const cb = useRef(onLogout);
  cb.current = onLogout;
  const t1 = useRef(null);
  const t2 = useRef(null);
  const armRef = useRef(() => {});

  useEffect(() => {
    if (!enabled) { setWarning(false); return; }
    const arm = () => {
      setWarning(false);
      clearTimeout(t1.current);
      clearTimeout(t2.current);
      t1.current = setTimeout(() => setWarning(true), Math.max(0, timeoutMs - warnMs));
      t2.current = setTimeout(() => cb.current && cb.current(), timeoutMs);
    };
    armRef.current = arm;
    const onAct = () => arm();
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, onAct, { passive: true }));
    arm();
    return () => {
      events.forEach((e) => window.removeEventListener(e, onAct));
      clearTimeout(t1.current);
      clearTimeout(t2.current);
    };
  }, [enabled, timeoutMs, warnMs]);

  return { warning, stay: () => armRef.current() };
}
