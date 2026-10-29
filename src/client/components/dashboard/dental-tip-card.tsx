import { useEffect, useState } from "react";
import { Quote, Sparkles } from "lucide-react";
import { ToothGlyph } from "@/components/dental-art";
import { cn } from "@/lib/utils";

/**
 * Rotating dental advice.
 *
 * The card changes on a timer so the dashboard keeps offering something new
 * to read between patients, but it is never the only way to see a tip: the
 * list is static, "Next tip" advances it on demand, and the interval pauses
 * while the pointer or keyboard focus is inside the card so text cannot
 * disappear mid-sentence.
 */

export interface DentalTip {
  text: string;
  source: string;
  kind: "advice" | "quote";
}

export const DENTAL_TIPS: DentalTip[] = [
  {
    kind: "advice",
    text: "Two minutes, twice a day. Most adults brush for barely 45 seconds — set the timer, not the habit.",
    source: "Preventive care",
  },
  {
    kind: "advice",
    text: "Recommend a soft-bristled brush and a fluoride toothpaste. Hard bristles and scrubbing wear enamel at the gumline.",
    source: "Preventive care",
  },
  {
    kind: "advice",
    text: "Floss once a day, ideally before the evening brush so fluoride stays on the cleaned surfaces overnight.",
    source: "Preventive care",
  },
  {
    kind: "quote",
    text: "Every tooth in a man's head is more valuable than a diamond.",
    source: "Miguel de Cervantes",
  },
  {
    kind: "advice",
    text: "Replace the toothbrush — or brush head — every three months, and after any illness.",
    source: "Preventive care",
  },
  {
    kind: "advice",
    text: "Sugar frequency matters more than sugar quantity: grazing on sweets keeps acid attacks going all day.",
    source: "Diet counselling",
  },
  {
    kind: "advice",
    text: "Wait 30 minutes after acidic food or drink before brushing. Scrubbing softened enamel removes it.",
    source: "Enamel care",
  },
  {
    kind: "quote",
    text: "You don't have to brush all your teeth — just the ones you want to keep.",
    source: "Dental humour, and also true",
  },
  {
    kind: "advice",
    text: "Bleeding gums usually mean inflammation, not aggressive brushing. Review technique before recommending a softer brush.",
    source: "Perio screening",
  },
  {
    kind: "advice",
    text: "A dry mouth raises caries risk. Review medications and suggest water over sugary drinks.",
    source: "Clinical reminder",
  },
  {
    kind: "advice",
    text: "Book the recall before the patient leaves the chair. A six-month slot kept is a filling avoided.",
    source: "Practice flow",
  },
  {
    kind: "quote",
    text: "The mouth is the gateway to the body — healthy gums are whole-body health.",
    source: "Periodontal medicine",
  },
];

/** Milliseconds between automatic tips. */
export const TIP_ROTATE_MS = 20_000;

export function DentalTipCard({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % DENTAL_TIPS.length);
    }, TIP_ROTATE_MS);
    return () => window.clearInterval(id);
  }, [paused]);

  const tip = DENTAL_TIPS[index];
  const next = () => setIndex((i) => (i + 1) % DENTAL_TIPS.length);

  return (
    <section
      aria-labelledby="dental-tip-heading"
      className={cn("dc-card relative overflow-hidden p-5", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
    >
      {/* Corner tooth watermark. The card's own height bounds it. */}
      <ToothGlyph className="pointer-events-none absolute -bottom-10 -right-7 h-32 w-32 text-primary/[0.04]" />

      <div className="relative flex items-center justify-between gap-2">
        <h2 id="dental-tip-heading" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          Dental wisdom
        </h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {paused ? "Paused" : "Every 20s"}
        </span>
      </div>

      {/* Not a live region: the tip rotates on a timer, and announcing a new
          sentence every 20 seconds would interrupt whatever the reader is on.
          "Next tip" is a real button for anyone who wants to advance it. */}
      <div key={index} className="dc-tip-in relative mt-3 min-h-[4.5rem]">
        <Quote className="mb-1 h-4 w-4 text-primary/50" aria-hidden="true" />
        <p className="text-sm font-medium leading-relaxed text-foreground/90">{tip.text}</p>
        <p className="mt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {tip.kind === "quote" ? `— ${tip.source}` : tip.source}
        </p>
      </div>

      <div className="relative mt-3 flex items-center gap-1.5">
        {DENTAL_TIPS.map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-300",
              i === index ? "w-5 bg-primary" : "w-1.5 bg-border",
            )}
          />
        ))}
        <button
          type="button"
          onClick={next}
          className="ml-auto text-[11px] font-semibold text-primary underline-offset-2 hover:underline"
        >
          Next tip
        </button>
      </div>
    </section>
  );
}
