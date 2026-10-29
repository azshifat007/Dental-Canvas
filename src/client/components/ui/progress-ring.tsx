import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Circular progress ring — the dashboard's metric gauge.
 *
 * Drawn as two SVG circles with rounded caps: a muted track and a coloured arc
 * whose `stroke-dashoffset` is animated from "empty" to the real value on
 * mount, so the number lands after the sweep instead of appearing with it.
 * The whole animation rides on the `.dc-ring-arc` transition, which the global
 * `.a11y-reduce-motion` block collapses to ~0ms — the ring then renders at its
 * final value with no motion, as required.
 *
 * Accessibility: the `<svg>` is a single `role="progressbar"` with its value
 * and a caller-supplied label; the visible number and caption are aria-hidden
 * so a screen reader hears "Session timer, 65 percent" once, not twice.
 */

export type RingTone = "brand" | "teal" | "amber" | "rose" | "violet";

/** Arc colour per tone. Kept on the text colour and painted with
 *  `currentColor`, so dark mode and the brand-accent setting both apply.
 *  `rose` is the danger colour; neutral metrics use `violet` so a gauge that
 *  reports "25% of today's visits are returning patients" does not read as
 *  an error. */
const TONE_TEXT: Record<RingTone, string> = {
  brand: "text-primary",
  teal: "text-teal-500",
  amber: "text-amber-500",
  rose: "text-rose-500",
  violet: "text-violet-500",
};

/** Clamp to a real percentage: NaN (an empty practice divides by zero) and
 *  out-of-range values become a ring that can actually be drawn. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** Geometry for a ring drawn in a 100×100 viewBox. Exported for tests. */
export function ringGeometry(value: number, thickness = 10) {
  const t = Math.min(40, Math.max(1, thickness));
  const radius = 50 - t / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = clampPercent(value);
  return {
    radius,
    circumference,
    percent,
    dashOffset: circumference * (1 - percent / 100),
  };
}

export function ProgressRing({
  value,
  size = 132,
  thickness = 10,
  tone = "brand",
  label,
  caption,
  children,
  className,
}: {
  value: number;
  /** Rendered diameter in px; the arc scales with it. */
  size?: number;
  /** Stroke width in viewBox units (1–40). */
  thickness?: number;
  tone?: RingTone;
  /** Accessible name, e.g. "Session timer". */
  label: string;
  /** Small caption under the number (not rendered when `children` is given). */
  caption?: string;
  /** Replaces the centred number — used for the icon inside a mini ring. */
  children?: ReactNode;
  className?: string;
}) {
  const { radius, circumference, percent, dashOffset } = ringGeometry(value, thickness);
  const [swept, setSwept] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setSwept(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        width={size}
        height={size}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label={label}
        className="-rotate-90"
      >
        <circle cx={50} cy={50} r={radius} fill="none" strokeWidth={thickness} className="stroke-muted" />
        <circle
          cx={50}
          cy={50}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={swept ? dashOffset : circumference}
          className={cn("dc-ring-arc", TONE_TEXT[tone])}
        />
      </svg>
      <div
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center"
        aria-hidden="true"
      >
        {children ?? (
          <>
            <span
              className="animate-count font-bold leading-none tracking-tight tabular-nums"
              style={{ fontSize: Math.round(size * 0.26) }}
            >
              {Math.round(percent)}
              <span className="font-semibold opacity-70" style={{ fontSize: Math.round(size * 0.13) }}>
                %
              </span>
            </span>
            {caption ? (
              <span className="mt-1.5 px-2 text-[10px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground">
                {caption}
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

