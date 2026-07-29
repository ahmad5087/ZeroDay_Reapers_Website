import { useEffect, useRef, useState } from "react";

// Autosave a text value to localStorage under `key`, restoring it on mount.
// Returns [value, setValue, clear]. SSR-safe (guards window). Use for form text so a
// refresh / disconnect doesn't lose what the user typed.
export function useDraft(key, initial = "") {
  const [value, setValue] = useState(initial);
  const loaded = useRef(false);

  // restore once on mount
  useEffect(() => {
    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(key) : null;
      if (saved != null) setValue(saved);
    } catch { /* private mode / disabled storage */ }
    loaded.current = true;
  }, [key]);

  // persist on change (skip the initial restore pass)
  useEffect(() => {
    if (!loaded.current) return;
    try {
      if (value) window.localStorage.setItem(key, value);
      else window.localStorage.removeItem(key);
    } catch { /* ignore */ }
  }, [key, value]);

  const clear = () => {
    try { window.localStorage.removeItem(key); } catch { /* ignore */ }
    setValue("");
  };

  return [value, setValue, clear];
}
