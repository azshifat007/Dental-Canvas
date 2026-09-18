import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "dental-canvas:theme";

function readStoredPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    return "system";
  }
}

/** Apply (or clear) the `.dark` class on <html> for a resolved preference. */
function applyPreference(pref: ThemePreference) {
  const dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

/**
 * Theme handling with three states:
 *  - "system" (default): follows the OS `prefers-color-scheme` live — the app
 *    switches the moment the OS flips, no reload needed.
 *  - "light" / "dark": explicit override, persisted in localStorage.
 *
 * The index.html no-flash script applies the same logic before first paint;
 * this hook takes over after React mounts and keeps it in sync.
 */
export function useTheme() {
  const [pref, setPref] = useState<ThemePreference>(readStoredPreference);

  useEffect(() => {
    applyPreference(pref);
    try {
      if (pref === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* storage unavailable — theme still works for this session */
    }
  }, [pref]);

  // Live-follow OS changes while in "system" mode.
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyPreference("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  // Cross-tab sync: changing the theme in one tab updates the others.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setPref(readStoredPreference());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((p: ThemePreference) => setPref(p), []);

  /** Sidebar-friendly: system → light → dark → system. */
  const cycleTheme = useCallback(() => {
    setPref((p) => (p === "system" ? "light" : p === "light" ? "dark" : "system"));
  }, []);

  return { pref, setTheme, cycleTheme };
}
