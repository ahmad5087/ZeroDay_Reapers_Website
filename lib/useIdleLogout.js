import { useEffect, useRef, useState } from "react";

// Warns, then auto-logs-out after `timeoutMs` of inactivity. Any real user activity re-arms it.
// Returns { warning, stay }. `stay` re-arms (used by the "Stay signed in" button).
export function useIdleLogout({ enabled, timeoutMs = 600000, warnMs = 60000, onLogout }) {
  const [warning, setWarning] = useState(false);
  const cb = useRef(onLogout);
  cb.current = onLogout;
  const warningTimer = useRef(null);
  const logoutTimer = useRef(null);
  const armRef = useRef(() => {});

  useEffect(() => {
    if (!enabled) {
      setWarning(false);
      armRef.current = () => {};
      return;
    }

    let lastActivityAt = Date.now();
    let lastTimerArmAt = 0;
    let logoutStarted = false;
    const warningAfterMs = Math.max(0, timeoutMs - warnMs);

    const clearTimers = () => {
      clearTimeout(warningTimer.current);
      clearTimeout(logoutTimer.current);
    };

    const idleFor = () => Math.max(0, Date.now() - lastActivityAt);

    const showWarningIfIdle = () => {
      const remaining = warningAfterMs - idleFor();
      if (remaining > 0) {
        warningTimer.current = setTimeout(showWarningIfIdle, remaining);
        return;
      }
      setWarning(true);
    };

    const logoutIfIdle = () => {
      const remaining = timeoutMs - idleFor();
      if (remaining > 0) {
        logoutTimer.current = setTimeout(logoutIfIdle, remaining);
        return;
      }
      if (!logoutStarted) {
        logoutStarted = true;
        cb.current?.();
      }
    };

    const scheduleTimers = () => {
      clearTimers();
      warningTimer.current = setTimeout(showWarningIfIdle, warningAfterMs);
      logoutTimer.current = setTimeout(logoutIfIdle, timeoutMs);
      lastTimerArmAt = Date.now();
    };

    const recordActivity = () => {
      const now = Date.now();
      lastActivityAt = now;
      setWarning(false);
      logoutStarted = false;

      // Pointer movement can fire dozens of times per second. Updating the true
      // activity time is cheap; only rebuild the timers once per second. Both
      // callbacks validate lastActivityAt before warning or signing out.
      if (now - lastTimerArmAt >= 1000) scheduleTimers();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") recordActivity();
    };
    const events = ["pointerdown", "pointermove", "keydown", "input", "wheel", "touchstart", "scroll"];
    const eventOptions = { capture: true, passive: true };

    armRef.current = recordActivity;
    events.forEach((event) => document.addEventListener(event, recordActivity, eventOptions));
    window.addEventListener("focus", recordActivity, { passive: true });
    window.addEventListener("pageshow", recordActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    scheduleTimers();

    return () => {
      events.forEach((event) => document.removeEventListener(event, recordActivity, true));
      window.removeEventListener("focus", recordActivity);
      window.removeEventListener("pageshow", recordActivity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimers();
    };
  }, [enabled, timeoutMs, warnMs]);

  return { warning, stay: () => armRef.current() };
}
