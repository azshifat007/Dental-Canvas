/**
 * Brand accent color support — see hooks/use-brand-accent.ts and the
 * --brand-hue / --brand-chroma-scale variables in styles.css.
 *
 * The app's accent palette is defined in OKLCH with a shared hue. To let a
 * clinic rebrand from any hex color, we convert that hex to OKLCH and extract
 * its hue (and a chroma scale so muted derivatives keep the picked color's
 * saturation character). Lightness values stay fixed per theme so contrast
 * ratios are never compromised by a dark or washed-out brand color.
 *
 * Conversion path: sRGB → linear RGB → OKLab → OKLCH (Björn Ottosson's
 * reference math, https://bottosson.github.io/posts/oklab/).
 */

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  l: number;
  /** Chroma (colorfulness), typically 0–0.37 for sRGB. */
  c: number;
  /** Hue in degrees, 0–360. */
  h: number;
}

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Convert a hex color (#rgb, #rrggbb) to OKLCH. Returns null on bad input. */
export function hexToOklch(hex: string): Oklch | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");

  const r = srgbToLinear(parseInt(s.slice(0, 2), 16) / 255);
  const g = srgbToLinear(parseInt(s.slice(2, 4), 16) / 255);
  const b = srgbToLinear(parseInt(s.slice(4, 6), 16) / 255);

  // Linear sRGB → LMS (OKLab's cone response), then the nonlinearity.
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  // LMS' → OKLab.
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  const C = Math.sqrt(a * a + b2 * b2);
  let H = (Math.atan2(b2, a) * 180) / Math.PI;
  if (H < 0) H += 360;

  return { l: L, c: C, h: H };
}

/**
 * Map a picked color onto the app's palette:
 *  - hue: the picked color's OKLCH hue (gray colors keep the previous-ish
 *    default; hue is meaningless near-zero chroma, so fall back to teal).
 *  - chromaScale: the picked color's chroma relative to a vivid sRGB primary
 *    (~0.2), clamped so very dull picks stay legible and vivid picks don't
 *    blow past the gamut of the light/dark derivations.
 */
export function brandAccentFromHex(hex: string): { hue: number; chromaScale: number } | null {
  const ok = hexToOklch(hex);
  if (!ok) return null;
  const hue = ok.c < 0.02 ? 195 : Math.round(ok.h) % 360;
  const chromaScale = Math.min(1.35, Math.max(0.35, ok.c / 0.2));
  return { hue, chromaScale: Math.round(chromaScale * 100) / 100 };
}
