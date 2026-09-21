import { useCallback, useEffect, useRef, useState } from "react";
import { ALargeSmall, Maximize2, Minimize2, Printer, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { PrescriptionSheet, PRESCRIPTION_TEMPLATES, type PrescriptionSheetData } from "./prescription-sheet";
import type { PrescriptionTemplate } from "@/types";
import { printSheetHtml } from "@/lib/print";
import { useMaterializedImages } from "@/lib/images";
import { cn } from "@/lib/utils";

/**
 * Full-size prescription preview: the true A4 sheet rendered at readable
 * scale in a near-viewport modal, with live template switching and a Print
 * action that uses the exact same markup. Opens from the editor (unsaved
 * drafts) and from the print view (saved prescriptions).
 */
export function PrescriptionPreviewModal({
  open,
  onOpenChange,
  data,
  title,
  onTemplateChange,
  onLargePrintChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  data: PrescriptionSheetData;
  /** Dialog a11y label, e.g. "Preview — Grace Hopper". */
  title: string;
  /** Present when the template can be switched right inside the preview. */
  onTemplateChange?: (t: PrescriptionTemplate) => void;
  /** Present when large print can be toggled right inside the preview. */
  onLargePrintChange?: (on: boolean) => void;
}) {
  const [template, setTemplate] = useState<PrescriptionTemplate>(data.template);
  const [largePrint, setLargePrint] = useState(Boolean(data.large_print));
  // Attached X-rays are fetched into data URLs so browser print and PDF
  // export see the bytes even though the URLs are cross-origin/presigned.
  const materialized = useMaterializedImages(data.images ?? []);
  const [fit, setFit] = useState(0.75);
  const [zoom, setZoom] = useState<number | null>(null); // null = follow `fit`
  const [fullBleed, setFullBleed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  // Callback ref: the measure effect must re-run once Radix actually mounts
  // the portal content (a plain ref is still null on first effect run).
  const [scrollerEl, setScrollerEl] = useState<HTMLDivElement | null>(null);

  // Sync when reopened so a stale template from last time never shows.
  useEffect(() => {
    if (open) {
      setTemplate(data.template);
      setLargePrint(Boolean(data.large_print));
      setZoom(null);
      setFullBleed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fit the A4 sheet to the modal's actual scroll area (measured, not
  // estimated), so toolbars/padding never push the sheet into scrollbars.
  const measure = useCallback(() => {
    const el = scrollerEl;
    if (!el) return;
    const MM = 3.7795; // px per mm
    // p-4 padding (32px) plus a little slack so rounding never scrolls.
    const pad = 40;
    const h = (el.clientHeight - pad) / (297 * MM);
    const w = (el.clientWidth - pad) / (210 * MM);
    setFit(Math.min(1.15, Math.max(0.3, Math.min(h, w))));
  }, [scrollerEl]);

  useEffect(() => {
    if (!open || !scrollerEl) return;
    // Skip the dialog's open-animation frames before the first measure.
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    const ro = new ResizeObserver(measure);
    ro.observe(scrollerEl);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, scrollerEl, measure]);

  const scale = zoom ?? fit;
  const effectiveData: PrescriptionSheetData = {
    ...data,
    template,
    large_print: largePrint,
    images: materialized.images ?? data.images,
  };
  const current = PRESCRIPTION_TEMPLATES.find((t) => t.id === template);

  function pickTemplate(t: PrescriptionTemplate) {
    setTemplate(t);
    onTemplateChange?.(t);
  }

  function toggleLargePrint(on: boolean) {
    setLargePrint(on);
    onLargePrintChange?.(on);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Fixed height: the scroller's size never depends on sheet content, so
          the fit measurement is stable even while fonts/images are loading. */}
      <DialogContent
        className="flex h-[95vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-none sm:rounded-lg"
        style={{ width: "min(96vw, calc((96vh - 88px) / 1.4142))" }}
        aria-describedby={undefined}
      >
        <div className="flex items-center gap-2 border-b bg-card px-3 py-2">
          <DialogTitle className="truncate text-sm font-semibold">{title}</DialogTitle>
          {onTemplateChange && (
            <select
              value={template}
              onChange={(e) => pickTemplate(e.target.value as PrescriptionTemplate)}
              className="ml-2 h-7 rounded-md border bg-background px-1.5 text-xs"
              aria-label="Template"
            >
              {PRESCRIPTION_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          )}
          {onLargePrintChange && (
            <button
              type="button"
              onClick={() => toggleLargePrint(!largePrint)}
              aria-pressed={largePrint}
              className={cn(
                "ml-1 inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent",
                largePrint && "border-primary bg-primary/10 text-primary",
              )}
              title="Enlarged medication and advice text for visually impaired patients"
            >
              <ALargeSmall className="h-3.5 w-3.5" /> Large print
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(0.3, (z ?? fit) - 0.1))}
              className="h-7 w-7 rounded-md border text-sm hover:bg-accent"
              title="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom(null)}
              className={cn(
                "h-7 rounded-md border px-2 text-xs hover:bg-accent",
                zoom === null && "border-primary text-primary",
              )}
              title="Fit to window"
            >
              {Math.round(scale * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(1.5, (z ?? fit) + 0.1))}
              className="h-7 w-7 rounded-md border text-sm hover:bg-accent"
              title="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setFullBleed((f) => !f)}
              className="ml-1 inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-accent"
              title={fullBleed ? "Show padding" : "Fill the window"}
            >
              {fullBleed ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              {fullBleed ? "Windowed" : "Full"}
            </button>
          </div>
        </div>

        <div
          ref={setScrollerEl}
          className={cn(
            "flex-1 overflow-auto bg-slate-200 dark:bg-slate-900",
            fullBleed ? "p-0" : "p-4",
          )}
        >
          {/* Outer box reserves the *scaled* size so no ghost scrollbars appear;
              the inner sheet keeps its true A4 layout and is visually scaled. */}
          <div
            className="mx-auto shadow-xl"
            style={{ width: `calc(210mm * ${scale})`, height: `calc(297mm * ${scale})` }}
          >
            <div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: "210mm" }}>
              <div ref={hostRef}>
                <PrescriptionSheet data={effectiveData} />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t bg-card px-3 py-2">
          <p className="truncate text-xs text-muted-foreground">
            {current?.label} · A4 210×297 mm · this is exactly what prints
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" /> Close
            </Button>
            <Button
              size="sm"
              onClick={() => printSheetHtml(hostRef.current, `Prescription — ${data.patient_name}`)}
            >
              <Printer className="h-4 w-4" /> Print
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
