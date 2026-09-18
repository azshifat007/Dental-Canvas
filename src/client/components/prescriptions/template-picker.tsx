import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PrescriptionTemplate } from "@/types";
import { PrescriptionSheet, PRESCRIPTION_TEMPLATES, type PrescriptionSheetData } from "./prescription-sheet";

/**
 * Template selection with WYSIWYG thumbnails: every option renders the real
 * PrescriptionSheet scaled down, so what you pick is exactly what prints.
 * Thumbnails are static (pointer-events off, aria-hidden) to keep the DOM
 * cheap — 7 tiny sheets render only while a picker is open.
 */

const SAMPLE_DATA: PrescriptionSheetData = {
  clinic_name: "Bright Smile Dental",
  clinic_address: "123 Main St",
  clinic_phone: "+1 555 010 2030",
  doctor_name: "Sarah",
  doctor_specialty: "Dentist",
  doctor_license: "DDS-102938",
  patient_name: "Jane Cooper",
  patient_age: "32 yrs",
  issued_date: new Date().toISOString().slice(0, 10),
  template: "classic",
  diagnosis: "Periapical abscess, tooth 36",
  advice: "Warm salt-water rinses.",
  follow_up: "Recheck in 2 weeks",
  items: [
    { drug_name: "Amoxicillin", dosage: "500 mg", frequency: "3x daily", duration: "5 days", instructions: "after meals" },
    { drug_name: "Ibuprofen", dosage: "400 mg", frequency: "as needed", duration: "3 days", instructions: null },
  ],
};

/** One scaled-down, non-interactive sheet thumbnail. */
export function TemplateThumbnail({
  template,
  width = 96,
}: {
  template: PrescriptionTemplate;
  width?: number;
}) {
  // A4 aspect ≈ 1 : 1.414
  return (
    <div
      aria-hidden
      className="pointer-events-none select-none overflow-hidden rounded-[3px] border border-border bg-white shadow-sm"
      style={{ width, height: Math.round(width * 1.414) }}
    >
      <div
        style={{
          width: "210mm",
          transformOrigin: "top left",
          transform: `scale(${width / (210 * 3.7795)})`,
        }}
      >
        <PrescriptionSheet data={{ ...SAMPLE_DATA, template }} />
      </div>
    </div>
  );
}

/** Dropdown-style picker used in the print view toolbar. */
export function TemplateDropdown({
  value,
  onChange,
}: {
  value: PrescriptionTemplate;
  onChange: (t: PrescriptionTemplate) => void;
}) {
  const current = PRESCRIPTION_TEMPLATES.find((t) => t.id === value);
  return (
    <details className="relative">
      <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{current?.label ?? value}</span>
        <Chevron />
      </summary>
      <div className="absolute right-0 z-50 mt-2 w-max rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prescription template</p>
        <div className="grid grid-cols-4 gap-2">
          {PRESCRIPTION_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                onChange(t.id);
                // Close the dropdown after choosing.
                const el = document.activeElement?.closest("details");
                if (el instanceof HTMLDetailsElement) el.open = false;
              }}
              className={cn(
                "group relative rounded-md border p-1.5 text-left transition-colors hover:bg-accent/40",
                value === t.id ? "border-primary ring-1 ring-primary" : "border-transparent",
              )}
              title={t.blurb}
            >
              <TemplateThumbnail template={t.id} width={88} />
              <div className="mt-1 flex items-center gap-1 text-[11px] font-medium">
                {value === t.id && <Check className="h-3 w-3 text-primary" />}
                {t.label}
              </div>
            </button>
          ))}
        </div>
      </div>
    </details>
  );
}

function Chevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/** Inline grid used in the create/edit dialog. */
export function TemplatePickerGrid({
  value,
  onChange,
}: {
  value: PrescriptionTemplate;
  onChange: (t: PrescriptionTemplate) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
      {PRESCRIPTION_TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          aria-pressed={value === t.id}
          className={cn(
            "group relative flex flex-col items-center gap-1 rounded-md border p-2 transition-colors",
            value === t.id
              ? "border-primary bg-accent/40 ring-1 ring-primary"
              : "hover:border-muted-foreground/30 hover:bg-accent/20",
          )}
          title={t.blurb}
        >
          <TemplateThumbnail template={t.id} width={64} />
          <span className="flex items-center gap-1 text-[11px] font-medium leading-none">
            {value === t.id && <Check className="h-3 w-3 text-primary" />}
            {t.label}
          </span>
        </button>
      ))}
    </div>
  );
}
