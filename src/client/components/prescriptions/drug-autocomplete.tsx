import { useEffect, useRef, useState } from "react";
import { Pill } from "lucide-react";
import { searchDentalDrugs, type DrugPreset } from "@/lib/dental-drugs";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Fired when the user commits a preset — the parent fills the rest of the row. */
  onPick: (preset: DrugPreset) => void;
  inputId?: string;
  required?: boolean;
}

/**
 * The drug-name field of a medication row, with autocomplete over the dental
 * preset library. Choosing a preset fills the whole row (dosage, frequency,
 * duration, instructions); free-typed values are always allowed and win.
 */
export function DrugAutocomplete({ value, onChange, onPick, inputId, required }: Props) {
  const [results, setResults] = useState<DrugPreset[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = `${inputId ?? "drug"}-suggestions`;

  // Re-run the search as the text changes.
  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setResults([]);
      setOpen(false);
      return;
    }
    const hits = searchDentalDrugs(q, 6);
    setResults(hits);
    setOpen(hits.length > 0);
    setActive(0);
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function pick(p: DrugPreset) {
    onChange(p.name);
    onPick(p);
    setOpen(false);
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
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <Input
        id={inputId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="Drug (required)"
        className="h-9"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        required={required}
      />
      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md"
        >
          {results.map((p, i) => (
            <li key={p.name}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  // mousedown so the input keeps focus; the click then commits.
                  e.preventDefault();
                  pick(p);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                  i === active ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <Pill className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {p.dosage} · {p.frequency} · {p.duration}
                    {p.instructions ? ` · ${p.instructions}` : ""}
                  </span>
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {p.group}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
