import { useCallback, useEffect, useState } from "react";

/**
 * Accessibility preferences — high contrast and reduced motion.
 *
 * Mirrors use-theme.ts: each preference has a "system" state that follows the
 * OS live (via `prefers-contrast: more` / `prefers-reduced-motion: reduce`),
 * plus explicit overrides persisted in localStorage. The resolved state is
 * applied as a class on <html>; the no-flash script in index.html applies the
 * same logic before first paint — keep the two in sync.
 */

export type A11yPreference = "system" | "on" | "off";

const CONTRAST_KEY = "dental-canvas:contrast";
const MOTION_KEY = "dental-canvas:reduced-motion";

function readStored(key: string): A11yPreference {
  try {
    const v = localStorage.getItem(key);
    return v === "on" || v === "off" ? v : "system";
  } catch {
    return "system";
  }
}

/** Apply (or clear) the `.a11y-contrast` / `.a11y-reduce-motion` classes. */
function applyClasses(contrast: A11yPreference, motion: A11yPreference) {
  const html = document.documentElement;
  const wantsContrast =
    contrast === "on" ||
    (contrast === "system" && window.matchMedia("(prefers-contrast: more)").matches);
  const wantsReducedMotion =
    motion === "on" ||
    (motion === "system" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  html.classList.toggle("a11y-contrast", wantsContrast);
  html.classList.toggle("a11y-reduce-motion", wantsReducedMotion);
}

function persist(key: string, pref: A11yPreference) {
  try {
    if (pref === "system") localStorage.removeItem(key);
    else localStorage.setItem(key, pref);
  } catch {
    /* storage unavailable — preference still works for this session */
  }
}

export function useAccessibility() {
  const [contrast, setContrastPref] = useState<A11yPreference>(() => readStored(CONTRAST_KEY));
  const [reduceMotion, setMotionPref] = useState<A11yPreference>(() => readStored(MOTION_KEY));

  useEffect(() => {
    applyClasses(contrast, reduceMotion);
    persist(CONTRAST_KEY, contrast);
    persist(MOTION_KEY, reduceMotion);
  }, [contrast, reduceMotion]);

  // Live-follow OS changes while a preference is in "system" mode.
  useEffect(() => {
    if (contrast !== "system") return;
    const mq = window.matchMedia("(prefers-contrast: more)");
    const onChange = () => applyClasses("system", reduceMotion);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [contrast, reduceMotion]);

  useEffect(() => {
    if (reduceMotion !== "system") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => applyClasses(contrast, "system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [contrast, reduceMotion]);

  // Cross-tab sync, same as the theme.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === CONTRAST_KEY) setContrastPref(readStored(CONTRAST_KEY));
      if (e.key === MOTION_KEY) setMotionPref(readStored(MOTION_KEY));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setContrast = useCallback((p: A11yPreference) => setContrastPref(p), []);
  const setReduceMotion = useCallback((p: A11yPreference) => setMotionPref(p), []);

  return { contrast, setContrast, reduceMotion, setReduceMotion };
}
