import { useCallback, useEffect, useState } from "react";
import { brandAccentFromHex } from "@/lib/color";

/**
 * Brand accent preference — the clinic's rebrand color.
 *
 * The value is a hex string (or null = the default teal). From it we derive
 * the CSS variables --brand-hue / --brand-chroma-scale on <html>; every
 * primary-derived token in styles.css re-colors instantly. Persistence and
 * cross-tab sync mirror use-theme.ts / use-accessibility.ts, and the no-flash
 * script in index.html applies the same logic before first paint — keep the
 * three in sync.
 */

const STORAGE_KEY = "dental-canvas:accent";

function readStored(): string | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v && brandAccentFromHex(v) ? v : null;
  } catch {
    return null;
  }
}

/** Apply (or clear) the brand variables on <html>. */
export function applyBrandAccent(hex: string | null) {
  const html = document.documentElement;
  if (!hex) {
    html.style.removeProperty("--brand-hue");
    html.style.removeProperty("--brand-chroma-scale");
    return;
  }
  const accent = brandAccentFromHex(hex);
  if (!accent) return;
  html.style.setProperty("--brand-hue", String(accent.hue));
  html.style.setProperty("--brand-chroma-scale", String(accent.chromaScale));
}

export function useBrandAccent() {
  const [accent, setAccentPref] = useState<string | null>(readStored);

  useEffect(() => {
    applyBrandAccent(accent);
    try {
      if (accent) localStorage.setItem(STORAGE_KEY, accent);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable — accent still works for this session */
    }
  }, [accent]);

  // Cross-tab sync, same as theme and accessibility prefs.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setAccentPref(readStored());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setAccent = useCallback((hex: string | null) => setAccentPref(hex), []);

  return { accent, setAccent };
}
