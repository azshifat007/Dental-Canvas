import { useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Pill } from "lucide-react";
import { searchDentalDrugs, type DrugGroup, type DrugPreset } from "@/lib/dental-drugs";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Fired when the user commits a preset — the parent fills the rest of the row. */
  onPick: (preset: DrugPreset) => void;
  inputId?: string;
  required?: boolean;
}

/** Compact one-line summary of what the preset will fill into the row. */
function presetSummary(p: DrugPreset): string {
  return [p.dosage, p.frequency, p.duration].filter(Boolean).join(" · ");
}

/**
 * The drug-name field of a medication row, with autocomplete over the dental
 * preset library. Choosing a preset fills the whole row (dosage, frequency,
 * duration, instructions); free-typed values are always allowed and win.
 *
 * The suggestion panel is a portalled popover rather than an absolutely
 * positioned list inside the medications scroller: at field width the names
 * and doses were cut off ("Azi…", "500…"), and the scroller clipped the list to
 * a row and a half. The panel is wide enough for a whole preset, flips above
 * the field when the form is near the bottom of the window, and scrolls on its
 * own with a slim scrollbar.
 */
export function DrugAutocomplete({ value, onChange, onPick, inputId, required }: Props) {
  const app = useApp();
  const [results, setResults] = useState<DrugPreset[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  /** Set by pick(): choosing a suggestion rewrites the value, which would
   *  otherwise re-run the search and pop the list straight back open. Cleared
   *  as soon as the user types again — not by the search effect, so a second
   *  render (e.g. the practice medicine list refreshing) cannot reopen it. */
  const pickedValue = useRef(false);
  const listId = `${inputId ?? "drug"}-suggestions`;
  const optionId = (i: number) => `${listId}-${i}`;

  // The practice's own medicine list (Lab → Medicines) leads the suggestions,
  // ahead of the built-in dental presets.
  const customPresets = useMemo<DrugPreset[]>(
    () =>
      app.medicines.map((m) => ({
        name: m.name,
        dosage: m.dosage ?? "",
        frequency: m.frequency ?? "",
        duration: m.duration ?? "",
        instructions: m.instructions ?? "",
        group: (m.drug_group as DrugGroup) || "Other",
      })),
    [app.medicines],
  );

  // Re-run the search as the text changes.
  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setResults([]);
      setOpen(false);
      return;
    }
    const hits = searchDentalDrugs(q, 6, customPresets);
    setResults(hits);
    setOpen(!pickedValue.current && hits.length > 0);
    setActive(0);
  }, [value, customPresets]);

  // Keep the highlighted option visible when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`)?.scrollIntoView({
      block: "nearest",
    });
  }, [active, open, results.length]);

  function pick(p: DrugPreset) {
    pickedValue.current = true;
    onChange(p.name);
    onPick(p);
    setOpen(false);
  }

  /** Deliberate typing always re-arms the suggestions. */
  function handleInput(next: string) {
    pickedValue.current = false;
    onChange(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      // Commit the highlighted preset instead of submitting the form.
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === "Tab") {
      // Radix restores focus on close; just leave the panel behind.
      setOpen(false);
    }
  }

  return (
    <Popover open={open && results.length > 0} onOpenChange={(next) => setOpen(next)}>
      <PopoverAnchor asChild>
        <Input
          id={inputId}
          value={value}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => {
            if (!pickedValue.current && results.length > 0) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Drug (required)"
          className="h-9"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open ? optionId(active) : undefined}
          required={required}
          autoComplete="off"
        />
      </PopoverAnchor>

      <PopoverContent
        // Radix gives this node role="dialog"; here it is just the combobox
        // popup, so drop the nested-dialog announcement.
        role="presentation"
        className="dc-drug-menu z-[70] w-[21rem] max-w-[calc(100vw-1.5rem)] overflow-hidden p-0"
        // Keep the caret in the drug field: the panel is a suggestion list, not
        // a menu the user tabs into.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/50 bg-muted/40 px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Dental drugs
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <kbd className="rounded border bg-background px-1 py-0.5 font-sans text-[10px]">↑↓</kbd>
            <span>then</span>
            <kbd className="rounded border bg-background px-1 py-0.5 font-sans text-[10px]">Enter</kbd>
          </span>
        </div>

        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label="Matching drugs"
          className="force-scrollbar max-h-72 space-y-0.5 overflow-y-auto p-1.5"
        >
          {results.map((p, i) => (
            <li key={p.name}>
              <button
                type="button"
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // mousedown so the input keeps focus; the click then commits.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors",
                  i === active ? "bg-primary/10 ring-1 ring-inset ring-primary/25" : "hover:bg-accent/70",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors",
                    i === active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Pill className="h-3.5 w-3.5" />
                </span>

                <span className="min-w-0 flex-1">
                  {/* Two lines rather than one: "Co-amoxiclav (Amoxicillin +
                      Clavulanic acid)" is a name nobody should have to guess
                      from "Co-amoxicla…". */}
                  <span className="block text-sm font-semibold leading-snug line-clamp-2 break-words">
                    {p.name}
                  </span>
                  <span className="mt-1 flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {p.group}
                    </span>
                    {presetSummary(p) && (
                      <span className="line-clamp-2 min-w-0 flex-1 text-xs text-muted-foreground">
                        {presetSummary(p)}
                      </span>
                    )}
                  </span>
                  {p.instructions && (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
                      {p.instructions}
                    </span>
                  )}
                </span>

                {i === active && (
                  <CornerDownLeft className="mt-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
