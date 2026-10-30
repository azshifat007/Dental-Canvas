import { useEffect, useMemo, useSyncExternalStore } from "react";
import { api } from "@/api";
import type {
  PrescriptionLayout,
  PrescriptionTemplate,
  PrescriptionTemplateId,
  RxSheetSection,
  RxTemplateConfig,
} from "@/types";
import { PRESCRIPTION_TEMPLATES } from "@/components/prescriptions/prescription-sheet";

export interface TemplateChoice {
  id: PrescriptionTemplateId;
  label: string;
  blurb: string;
  /** Present for a custom template: its saved skin. */
  config?: RxTemplateConfig | null;
  custom?: boolean;
}

/**
 * Practice-defined prescription templates (Settings → Rx templates).
 *
 * The server owns them (`/api/prescription-layouts`); this module keeps one
 * shared list so every picker, thumbnail and preview agrees without refetching
 * per component. A custom template's id on a prescription is `custom-<id>`;
 * its config travels with the prescription on read (see loadPrescription), so
 * printing and the public share page never depend on this cache.
 */

const EMPTY: PrescriptionLayout[] = [];
let cache: PrescriptionLayout[] | null = null;
let inflight: Promise<PrescriptionLayout[]> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Replace the cache (used by the Settings editor after a save/delete). */
export function setPrescriptionLayouts(layouts: PrescriptionLayout[]) {
  cache = layouts;
  emit();
}

/** Fetch the practice's templates once; call again to refresh. */
export function loadPrescriptionLayouts(force = false): Promise<PrescriptionLayout[]> {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight && !force) return inflight;
  inflight = api<{ layouts: PrescriptionLayout[] }>("GET", "/api/prescription-layouts")
    .then((res) => {
      setPrescriptionLayouts(res.layouts ?? EMPTY);
      return cache ?? EMPTY;
    })
    .catch(() => {
      // A failed load leaves the built-ins usable; the editor surfaces the error.
      return cache ?? EMPTY;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The practice's custom templates, kept current across components. */
export function usePrescriptionLayouts(): PrescriptionLayout[] {
  const layouts = useSyncExternalStore(
    subscribe,
    () => cache ?? EMPTY,
    () => EMPTY,
  );
  useEffect(() => {
    void loadPrescriptionLayouts();
  }, []);
  return layouts;
}

/** One custom template by id, or undefined for built-ins. */
export function findLayout(layouts: PrescriptionLayout[], id: string): PrescriptionLayout | undefined {
  return layouts.find((l) => l.slug === id);
}

/** Everything a prescription can be printed with: built-ins, then the practice's own. */
export function useTemplateChoices(): TemplateChoice[] {
  const layouts = usePrescriptionLayouts();
  return useMemo(
    () => [
      ...PRESCRIPTION_TEMPLATES.map((t) => ({ id: t.id as PrescriptionTemplateId, label: t.label, blurb: t.blurb })),
      ...layouts.map((l) => ({
        id: l.slug,
        label: l.name,
        blurb: `Your template · from ${l.based_on}`,
        config: l.config,
        custom: true,
      })),
    ],
    [layouts],
  );
}

// ── Editor model ────────────────────────────────────────────────────

export const RX_SECTION_LABELS = {
  diagnosis: "C/C — complaint",
  on_examination: "O/E — on examination",
  history: "H/O — history",
  treatment_plan: "Treatment plan",
  complaints: "Complaints",
  investigations: "Investigations",
  vitals: "Vitals",
  xray: "X-ray images",
} as const;

/** Every section, in the default print order. */
export function defaultSections(): RxSheetSection[] {
  return (Object.keys(RX_SECTION_LABELS) as (keyof typeof RX_SECTION_LABELS)[]).map((key) => ({
    key,
    label: "",
    enabled: true,
  }));
}

/**
 * The config a built-in template starts from, so "Edit" on a gallery card
 * opens the editor looking like that template. Editing always saves a custom
 * copy — the built-ins stay available unchanged.
 */
export function baseRxConfig(basedOn: PrescriptionTemplate): RxTemplateConfig {
  const base: RxTemplateConfig = {
    layout: "stacked",
    accent: "#0e7490",
    header_bg: "#ffffff",
    header_text: "#0f172a",
    font: "sans",
    show_rule: true,
    show_logo: true,
    show_bangla: false,
    show_watermark: false,
    show_signature: true,
    footer_note: "",
    sections: defaultSections(),
  };
  switch (basedOn) {
    case "chamber":
      return {
        ...base,
        layout: "sidebar",
        accent: "#166534",
        header_bg: "#eaf3e2",
        header_text: "#14532d",
        show_bangla: true,
        show_watermark: true,
      };
    case "modern":
      return { ...base, accent: "#0e7490", header_bg: "#0e7490", header_text: "#ffffff", show_rule: false };
    case "compact":
      return { ...base, accent: "#0e7490", header_bg: "#ffffff", header_text: "#0f172a" };
    case "elegant":
      return { ...base, accent: "#9a3412", header_bg: "#ffffff", header_text: "#1c1917", font: "serif", show_rule: false };
    case "minimal":
      return { ...base, accent: "#111827", header_bg: "#ffffff", header_text: "#111827", show_rule: false, show_logo: false };
    case "bold":
      return { ...base, accent: "#d97706", header_bg: "#0f172a", header_text: "#ffffff" };
    case "watermark":
      return { ...base, accent: "#0d9488", header_bg: "#ffffff", header_text: "#134e4a", show_watermark: true };
    case "two-column":
      return { ...base, accent: "#0e7490", header_bg: "#ffffff", header_text: "#0f172a" };
    case "classic":
    default:
      return base;
  }
}

/** A blank draft config for a brand-new template. */
export function newRxConfig(): RxTemplateConfig {
  return baseRxConfig("chamber");
}

/** Swatches offered in the editor’s color rows. */
export const RX_ACCENT_SWATCHES = [
  "#166534",
  "#0e7490",
  "#0d9488",
  "#1d4ed8",
  "#7c3aed",
  "#b91c1c",
  "#c2410c",
  "#b45309",
  "#0f172a",
] as const;

export const RX_HEADER_SWATCHES = [
  "#ffffff",
  "#eaf3e2",
  "#e0f2fe",
  "#f1f5f9",
  "#166534",
  "#0e7490",
  "#0f172a",
  "#7c2d12",
] as const;
