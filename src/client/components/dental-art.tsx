import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * Dental artwork.
 *
 * Everything here is decorative: the tooth marks carry no meaning a screen
 * reader needs, so the illustrations and the drifting backdrop are marked
 * `aria-hidden`. Nothing depends on animation for information — the drifting
 * teeth are frozen by the `.a11y-reduce-motion` block in styles.css.
 */

/** Single molar silhouette — the app's dental mark. */
export function ToothGlyph({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" className={className} style={style}>
      <path d="M32 5.6c-4.7 0-7.7 2.2-12.3 2.2C11.4 7.8 5 14.1 5 23.4c0 7 2.7 11.1 4.4 16.4 1.5 4.8 1.5 11.6 2.8 16.9.9 3.7 2.5 6.8 5 6.8 3.2 0 3.8-4.8 5.2-10.3 1.1-4.3 2.7-7.6 6-7.6h7.2c3.3 0 4.9 3.3 6 7.6 1.4 5.5 2 10.3 5.2 10.3 2.5 0 4.1-3.1 5-6.8 1.3-5.3 1.3-12.1 2.8-16.9 1.7-5.3 4.4-9.4 4.4-16.4 0-9.3-6.4-15.6-14.7-15.6-4.6 0-7.6-2.2-12.3-2.2Z" />
    </svg>
  );
}

/** Softly shaded tooth for the hero panel. */
export function ToothIllustration({ className }: { className?: string }) {
  const id = useId().replace(/[:]/g, "");
  const enamel = `enamel-${id}`;
  const root = `root-${id}`;
  return (
    <svg viewBox="0 0 200 200" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={enamel} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(1 0 0)" />
          <stop offset="55%" stopColor="oklch(0.97 0.02 195)" />
          <stop offset="100%" stopColor="oklch(0.9 0.035 200)" />
        </linearGradient>
        <linearGradient id={root} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="oklch(0.95 0.03 195)" />
          <stop offset="100%" stopColor="oklch(0.86 0.04 205)" />
        </linearGradient>
      </defs>

      {/* Shadow pooled under the tooth. */}
      <ellipse cx="100" cy="176" rx="52" ry="9" fill="oklch(0.6 0.05 220 / 0.18)" />

      <g transform="translate(20 14) scale(2.5)">
        <path
          d="M32 5.6c-4.7 0-7.7 2.2-12.3 2.2C11.4 7.8 5 14.1 5 23.4c0 7 2.7 11.1 4.4 16.4 1.5 4.8 1.5 11.6 2.8 16.9.9 3.7 2.5 6.8 5 6.8 3.2 0 3.8-4.8 5.2-10.3 1.1-4.3 2.7-7.6 6-7.6h7.2c3.3 0 4.9 3.3 6 7.6 1.4 5.5 2 10.3 5.2 10.3 2.5 0 4.1-3.1 5-6.8 1.3-5.3 1.3-12.1 2.8-16.9 1.7-5.3 4.4-9.4 4.4-16.4 0-9.3-6.4-15.6-14.7-15.6-4.6 0-7.6-2.2-12.3-2.2Z"
          fill={`url(#${enamel})`}
          stroke="oklch(0.78 0.04 205 / 0.55)"
          strokeWidth="0.8"
        />
        {/* Root shading on the lower lobes. */}
        <path
          d="M17 38c.5 4 1.2 9.4 2.3 13.6.9 3.7 2.5 6.8 5 6.8 3.2 0 3.8-4.8 5.2-10.3.4-1.6.9-3.1 1.6-4.3-4.6-1.1-9.4-3.2-14.1-5.8Zm30 0c-4.7 2.6-9.5 4.7-14.1 5.8.7 1.2 1.2 2.7 1.6 4.3 1.4 5.5 2 10.3 5.2 10.3 2.5 0 4.1-3.1 5-6.8 1.1-4.2 1.8-9.6 2.3-13.6Z"
          fill={`url(#${root})`}
          opacity="0.7"
        />
        {/* Enamel sheen. */}
        <path
          d="M14 16c1.6-3.6 5-6 9.2-6.6"
          fill="none"
          stroke="oklch(1 0 0 / 0.9)"
          strokeLinecap="round"
          strokeWidth="2.4"
        />
        <path
          d="M22 30c2.6-2 5.7-3.1 9-3.1"
          fill="none"
          stroke="oklch(1 0 0 / 0.65)"
          strokeLinecap="round"
          strokeWidth="1.6"
        />
      </g>

      {/* Sparkles around the tooth. */}
      <g fill="oklch(0.72 0.12 195)">
        <path d="M162 52l2.6 6.4 6.4 2.6-6.4 2.6-2.6 6.4-2.6-6.4-6.4-2.6 6.4-2.6z" opacity="0.85" />
        <path d="M42 118l1.8 4.4 4.4 1.8-4.4 1.8-1.8 4.4-1.8-4.4-4.4-1.8 4.4-1.8z" opacity="0.7" />
        <circle cx="150" cy="140" r="3.2" opacity="0.55" />
        <circle cx="56" cy="44" r="2.4" opacity="0.5" />
      </g>
    </svg>
  );
}

/**
 * Drifting tooth outlines behind the dashboard. The wrapper is clipped and
 * inert; the teeth are laid out as percentages so the composition holds at any
 * scroll height. `aria-hidden` keeps the whole layer out of the a11y tree.
 */
export function DentalBackdrop({ className }: { className?: string }) {
  const teeth = [
    { top: "2%", left: "3%", size: 132, rotate: -14, opacity: 0.07 },
    { top: "22%", left: "84%", size: 96, rotate: 18, opacity: 0.06 },
    { top: "46%", left: "-2%", size: 78, rotate: 8, opacity: 0.05 },
    { top: "68%", left: "72%", size: 140, rotate: -8, opacity: 0.06 },
    { top: "88%", left: "12%", size: 104, rotate: 16, opacity: 0.05 },
    { top: "34%", left: "46%", size: 68, rotate: -22, opacity: 0.04 },
  ];
  const sparkles = [
    { top: "12%", left: "34%", size: 10 },
    { top: "30%", left: "62%", size: 7 },
    { top: "58%", left: "18%", size: 9 },
    { top: "76%", left: "52%", size: 6 },
    { top: "94%", left: "86%", size: 8 },
  ];

  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      {teeth.map((t, i) => (
        <ToothGlyph
          key={`tooth-${i}`}
          className="dc-tooth-float absolute text-primary"
          // Inline placement only; the drift itself is a CSS keyframe.
          style={
            {
              top: t.top,
              left: t.left,
              width: t.size,
              height: t.size,
              opacity: t.opacity,
              "--drift-i": i,
              "--drift-rot": `${t.rotate}deg`,
            } as React.CSSProperties
          }
        />
      ))}
      {sparkles.map((s, i) => (
        <svg
          key={`sparkle-${i}`}
          viewBox="0 0 24 24"
          className="dc-sparkle absolute text-teal-500"
          aria-hidden="true"
          style={
            {
              top: s.top,
              left: s.left,
              width: s.size,
              height: s.size,
              "--sparkle-i": i,
            } as React.CSSProperties
          }
        >
          <path
            d="M12 0l3 9 9 3-9 3-3 9-3-9-9-3 9-3z"
            fill="currentColor"
          />
        </svg>
      ))}
    </div>
  );
}
