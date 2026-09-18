import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  CalendarPlus,
  CircleDollarSign,
  CreditCard,
  FlaskConical,
  Loader2,
  MapPin,
  Search,
  Shield,
  Stethoscope,
  Syringe,
  FileText,
  ListChecks,
  Clock,
  Users,
  CornerDownLeft,
} from "lucide-react";
import { api } from "@/api";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { SearchHit, SearchEntityType } from "@/types";

/** Entity type → sidebar section label + icon, in fixed display order. */
const GROUPS: { type: SearchEntityType; label: string; icon: typeof Users }[] = [
  { type: "patients", label: "Patients", icon: Users },
  { type: "appointments", label: "Appointments", icon: Calendar },
  { type: "clinical_notes", label: "Clinical notes", icon: FileText },
  { type: "treatment_plan_items", label: "Treatment plan", icon: ListChecks },
  { type: "invoices", label: "Invoices", icon: CircleDollarSign },
  { type: "invoice_items", label: "Invoice items", icon: CreditCard },
  { type: "insurance_plans", label: "Insurance", icon: Shield },
  { type: "lab_cases", label: "Lab cases", icon: FlaskConical },
  { type: "waiting_list", label: "Waiting list", icon: Clock },
  { type: "appointments_to_make", label: "To make", icon: CalendarPlus },
  { type: "tooth_conditions", label: "Tooth chart", icon: Stethoscope },
  { type: "practitioners", label: "Practitioners", icon: Stethoscope },
  { type: "operatories", label: "Operatories", icon: MapPin },
  { type: "treatment_types", label: "Treatments", icon: Syringe },
];

/** Where each kind of hit navigates. */
function navigateTo(hit: SearchHit, navigate: (to: string) => void) {
  switch (hit.entity_type) {
    case "patients":
      navigate(`/patients/${hit.id}`);
      return;
    case "appointments":
      navigate("/agenda");
      return;
    case "lab_cases":
      navigate("/lab");
      return;
    case "operatories":
    case "practitioners":
    case "treatment_types":
      navigate("/settings");
      return;
    default:
      // Patient-scoped entities land on the owning patient's record.
      if (hit.patient_id != null) navigate(`/patients/${hit.patient_id}`);
      else navigate("/patients");
  }
}

/** Render a "[bracketed]" snippet from the API, highlighting the brackets. */
function Snippet({ text }: { text: string }) {
  const parts = useMemo(() => text.split(/(\[[^\]]*\])/g), [text]);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("[") && part.endsWith("]") && part.length > 2 ? (
          <mark key={i} className="rounded bg-amber-100 px-0.5 text-foreground dark:bg-amber-400/30">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * Global hotkey: ⌘K / Ctrl+K anywhere, or "/" when not typing in a field.
 * Mount once at the app shell.
 */
export function useGlobalSearchHotkey(open: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        open();
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);
}

export function SearchPalette({
  open,
  onOpenChange,
  navigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  navigate: (to: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Debounced search with a race guard so stale responses never win.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api<{ hits: SearchHit[] }>(
          "GET",
          `/api/search?q=${encodeURIComponent(q)}&limit=60`,
        );
        if (!cancelled) {
          setHits(res.hits);
          setSelected(0);
        }
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, open]);

  // Group hits by entity type in fixed display order.
  const groups = useMemo(() => {
    const byType = new Map<SearchEntityType, SearchHit[]>();
    for (const hit of hits) {
      const list = byType.get(hit.entity_type) ?? [];
      list.push(hit);
      byType.set(hit.entity_type, list);
    }
    return GROUPS.filter((g) => byType.has(g.type)).map((g) => ({
      ...g,
      items: byType.get(g.type)!,
    }));
  }, [hits]);

  // One flattened list drives keyboard navigation across group boundaries.
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const go = useCallback(
    (hit: SearchHit) => {
      close();
      navigateTo(hit, navigate);
    },
    [close, navigate],
  );

  // Keep the selected row visible while arrowing through long result lists.
  useEffect(() => {
    scrollRef.current
      ?.querySelector(`[data-result-index="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[selected];
      if (hit) go(hit);
    }
  };

  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[15%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0"
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patients, appointments, notes, billing…"
            className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm"
            autoFocus
          />
          {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
          <kbd className="hidden shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground sm:block">
            ESC
          </kbd>
        </div>

        <div ref={scrollRef} className="max-h-[50vh] overflow-y-auto p-2">
          {!query.trim() ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              Type to search across every record — patients, appointments, notes,
              treatment plans, billing, insurance, and lab cases.
            </div>
          ) : flat.length === 0 && !loading ? (
            <div className="px-3 py-10 text-center text-sm text-muted-foreground">
              No results for “{query.trim()}”.
            </div>
          ) : (
            groups.map((group) => {
              const Icon = group.icon;
              return (
                <div key={group.type} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Icon className="h-3 w-3" />
                    {group.label}
                  </div>
                  {group.items.map((hit) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    return (
                      <button
                        key={`${hit.entity_type}:${hit.id}`}
                        type="button"
                        data-result-index={idx}
                        onMouseEnter={() => setSelected(idx)}
                        onClick={() => go(hit)}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors",
                          idx === selected
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent/60",
                        )}
                      >
                        <span className="w-full truncate text-sm font-medium">{hit.title}</span>
                        {hit.snippet && (
                          <span className="w-full truncate text-xs text-muted-foreground">
                            <Snippet text={hit.snippet} />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-3 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 py-0.5 font-semibold">↑↓</kbd> navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border bg-muted px-1 py-0.5 font-semibold">
              <CornerDownLeft className="inline h-3 w-3" />
            </kbd>{" "}
            open
          </span>
          <span className="ml-auto">
            {flat.length > 0 && `${flat.length} result${flat.length === 1 ? "" : "s"}`}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
