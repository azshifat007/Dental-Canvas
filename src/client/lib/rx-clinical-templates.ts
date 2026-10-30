import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/api";
import type { RxClinicalTemplate, RxTemplateSource } from "@/types";

/**
 * Reusable prescription templates saved from a finished Rx (medications +
 * advice + the clinical note).
 *
 * One shared list, like the sheet layouts: the composer's "Use template" menu
 * and every "Save as template" button read and write the same cache, so a
 * template saved from the print view is offered in the next prescription
 * without a reload. The server owns the rows
 * (`/api/prescription-templates`).
 */

const EMPTY: RxClinicalTemplate[] = [];
let cache: RxClinicalTemplate[] | null = null;
let inflight: Promise<RxClinicalTemplate[]> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setRxClinicalTemplates(templates: RxClinicalTemplate[]) {
  cache = templates;
  emit();
}

/** Fetch the practice's clinical templates once; call again to refresh. */
export function loadRxClinicalTemplates(force = false): Promise<RxClinicalTemplate[]> {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight && !force) return inflight;
  inflight = api<{ templates: RxClinicalTemplate[] }>("GET", "/api/prescription-templates")
    .then((res) => {
      setRxClinicalTemplates(res.templates ?? EMPTY);
      return cache ?? EMPTY;
    })
    .catch(() => {
      // A failed load just leaves the menu empty; the editor surfaces errors.
      return cache ?? EMPTY;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The practice's clinical templates, kept current across components. */
export function useRxClinicalTemplates(): RxClinicalTemplate[] {
  const templates = useSyncExternalStore(
    subscribe,
    () => cache ?? EMPTY,
    () => EMPTY,
  );
  useEffect(() => {
    void loadRxClinicalTemplates();
  }, []);
  return templates;
}

/** Only rows with a drug name are worth storing — a blank row is not content. */
function usableItems(source: RxTemplateSource) {
  return source.items
    .filter((i) => i.drug_name.trim())
    .map((i) => ({
      drug_name: i.drug_name.trim(),
      dosage: i.dosage?.trim() || null,
      frequency: i.frequency?.trim() || null,
      schedule: i.schedule || null,
      meal_relation: i.meal_relation || null,
      duration: i.duration?.trim() || null,
      instructions: i.instructions?.trim() || null,
    }));
}

/** Save an open Rx as a reusable template, then show it in every picker. */
export async function saveRxClinicalTemplate(name: string, source: RxTemplateSource): Promise<RxClinicalTemplate> {
  const res = await api<{ template: RxClinicalTemplate }>("POST", "/api/prescription-templates", {
    name: name.trim(),
    diagnosis: source.diagnosis?.trim() || null,
    on_examination: source.on_examination?.trim() || null,
    history: source.history?.trim() || null,
    advice: source.advice?.trim() || null,
    items: usableItems(source),
  });
  setRxClinicalTemplates([res.template, ...(cache ?? [])]);
  return res.template;
}

/** Remove a saved template. Prescriptions already issued are untouched. */
export async function deleteRxClinicalTemplate(id: number): Promise<void> {
  await api("DELETE", `/api/prescription-templates/${id}`);
  setRxClinicalTemplates((cache ?? EMPTY).filter((t) => t.id !== id));
}

/**
 * A name that already describes the Rx, so "Save as template" usually needs
 * no typing: the diagnosis when it is short enough, else the drug names.
 */
export function suggestedTemplateName(source: RxTemplateSource): string {
  const dx = (source.diagnosis ?? "").trim().replace(/\s+/g, " ");
  if (dx) {
    const short = dx.length > 52 ? `${dx.slice(0, 49).trimEnd()}…` : dx;
    return short.charAt(0).toUpperCase() + short.slice(1);
  }
  const drugs = usableItems(source)
    .map((i) => i.drug_name)
    .slice(0, 3);
  if (drugs.length) return `${drugs.join(" + ")} protocol`;
  return "My prescription template";
}

/** Human summary of what a template carries, used in the menu and the dialog. */
export function templateSummary(t: { items: { drug_name: string }[]; advice?: string | null }): string {
  const n = t.items.length;
  const meds = `${n} medication${n === 1 ? "" : "s"}`;
  return t.advice?.trim() ? `${meds} · advice` : meds;
}
