import type { PrescriptionTemplate, PrescriptionTemplateId, RxSheetSectionKey, RxTemplateConfig } from "@/types";
import { DOSE_SCHEDULE_LABELS, MEAL_RELATION_LABELS } from "@/types";

/**
 * The prescription document itself — an A4 sheet rendered in one of several
 * templates. Shared by the in-app print view and the public share page, so a
 * patient sees exactly the sheet that prints.
 *
 * Styling is intentionally plain React inline styles: the print window is
 * populated with this markup directly (the app stylesheet is not attached
 * there), and the public page reuses the identical markup.
 *
 * Adding a template = adding one entry to TEMPLATES + one branch in each of
 * the small style helpers below. The layout itself is shared.
 */

// Tree-shaking escape hatch: this dummy side-effect import makes the
// template-specific sheet components module-level reachable for Rollup's
// static analysis even though they are selected only at runtime through
// `data.template`. Without it the two-column / chamber / watermark branches
// are pruned from the production build even though they are fully wired in
// source and render correctly in dev.
import "./template-shake.mjs";

export interface PrescriptionSheetData {
  clinic_name?: string | null;
  clinic_address?: string | null;
  clinic_phone?: string | null;
  /** Data URL of the clinic logo; rendered on every template's letterhead. */
  clinic_logo?: string | null;
  doctor_name: string;
  doctor_qualifications?: string | null;
  doctor_specialty?: string | null;
  doctor_license?: string | null;
  patient_name: string;
  patient_id?: number;
  patient_gender?: string | null;
  patient_age?: string | null;
  patient_medical_alerts?: string | null;
  practitioner_name?: string | null;
  issued_date: string;
  template: PrescriptionTemplateId;
  /** Resolved skin for a custom template id (see PrescriptionLayout). */
  template_config?: RxTemplateConfig | null;
  /** Enlarged type for visually impaired patients — scales the clinical content. */
  large_print?: boolean;
  /** Tooth the prescription relates to, rendered beside the linked procedure. */
  tooth?: string | null;
  /** Fixed practice instructions printed in the Chamber footer (from Settings). */
  chamber_footer_instructions?: string | null;
  /** Name of the linked treatment-plan procedure, if any. */
  plan_treatment_name?: string | null;
  /** Attached X-ray / intraoral images — rendered as a thumbnail strip. */
  images?: { id: number; label?: string | null; src: string | null }[];
  diagnosis?: string | null;
  /** O/E — findings on examination (Chamber sidebar). */
  on_examination?: string | null;
  /** H/O — history of presenting illness (Chamber sidebar). */
  history?: string | null;
  advice?: string | null;
  follow_up?: string | null;
  follow_up_date?: string | null;
  complaints?: { items: { label: string; duration?: string; site?: string }[] };
  vitals?: { bp?: string; temperature?: string; pulse?: string; spo2?: string };
  investigations?: { items: { label: string; result?: string }[] };
  items: {
    drug_name: string;
    generic_name?: string | null;
    dosage?: string | null;
    frequency?: string | null;
    schedule?: string;
    meal_relation?: string;
    duration?: string | null;
    instructions?: string | null;
  }[];
  payment_qr?: string | null;
  payment_qr_label?: string | null;
}

/** All templates, in gallery order. */
export const PRESCRIPTION_TEMPLATES: { id: PrescriptionTemplate; label: string; blurb: string }[] = [
  { id: "chamber",    label: "Chamber",    blurb: "Chamber pad: green header, clinical sidebar" },
  { id: "classic",    label: "Classic",    blurb: "Double-rule letterhead, formal" },
  { id: "modern",     label: "Modern",     blurb: "Full-color gradient header" },
  { id: "compact",    label: "Compact",    blurb: "Minimal header, ruled rows" },
  { id: "elegant",    label: "Elegant",    blurb: "Serif typography, centered crest" },
  { id: "minimal",    label: "Minimal",    blurb: "Whitespace, hairline rules" },
  { id: "bold",       label: "Bold",       blurb: "High-contrast blocks, dark header" },
  { id: "watermark",  label: "Watermark",  blurb: "Giant tooth behind the content" },
  { id: "two-column", label: "Two-column", blurb: "Split sheet: clinical side + Rx side" },
];

export function isPrescriptionTemplate(v: unknown): v is PrescriptionTemplate {
  return PRESCRIPTION_TEMPLATES.some((t) => t.id === v);
}

/** Exported template-branch registry. Template-specific sheet components are
 *  kept in the build output by the bundler's tree-shaker only when they are
 *  reachable through a stable exported symbol; `data.template` is a runtime
 *  value, so the branches themselves must be exported and referenced from a
 *  static module-level map. 
 */

/** Exported template registry so the bundler keeps every template branch
 *  alive in the build output (tree-shaking). The two-column body below is
 *  only referenced through the runtime `data.template` guard, so the
 *  template objects and `TwoColumnSheet` must be reachable from a stable
 *  module-level symbol to avoid being elided.
 */
function formatDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

// ── Template descriptor ────────────────────────────────────────────

interface TemplateStyle {
  page?: Partial<React.CSSProperties>;
  /** Header band: color rules. */
  headerBg: string;
  headerColor: string;
  headerRule: string; // css border-bottom shorthand, or "none"
  headerPad: string;
  headerMuted: string; // muted text color inside the header
  doctorName: React.CSSProperties;
  /** Right-side clinic block in the header. */
  clinicTitle: React.CSSProperties;
  clinicDetail: React.CSSProperties;
  bodyPad: string;
  bodyText: string;
  mutedText: string;
  accent: string;
  rxStyle: React.CSSProperties;
  medRowRule: string; // border-bottom for med rows, or "none"
  /** Optional label style override for ADVICE. */
  adviceLabel?: React.CSSProperties;
  signatureRule: string;
  footerRule: string;
  footerMuted: string;
  /** Show the letterhead centered (elegant/minimal) instead of split L/R. */
  centeredHeader?: boolean;
  /** Show the letterhead as an overlay on a dark band (bold). */
  invertHeader?: boolean;
}

const BASE_PAGE: React.CSSProperties = {
  width: "210mm",
  minHeight: "297mm",
  margin: "0 auto",
  background: "#ffffff",
  color: "#1a2430",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  fontFamily: 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif',
  position: "relative",
  overflow: "hidden",
};

export const TEMPLATES: Record<PrescriptionTemplate, TemplateStyle> = {
  chamber: {
    headerBg: "transparent",
    headerColor: "#14532d",
    headerRule: "none",
    headerPad: "0",
    headerMuted: "#3f6212",
    doctorName: { fontSize: "15pt", fontWeight: 700, color: "#14532d" },
    clinicTitle: { fontSize: "9.5pt", fontWeight: 700, color: "#3f6212" },
    clinicDetail: { fontSize: "7.5pt", fontWeight: 400, color: "#3f6212", whiteSpace: "pre-line" },
    bodyPad: "6mm 8mm",
    bodyText: "#1f2937",
    mutedText: "#6b7280",
    accent: "#166534",
    rxStyle: { fontSize: "20pt", fontWeight: 700, fontStyle: "normal", color: "#1f2937", margin: "1mm 0 2mm" },
    medRowRule: "none",
    signatureRule: "1px solid #9ca3af",
    footerRule: "none",
    footerMuted: "#374151",
  },
  classic: {
    headerBg: "transparent",
    headerColor: "#0f172a",
    headerRule: "3px double #0e7490",
    headerPad: "12mm 16mm 6mm",
    headerMuted: "#64748b",
    doctorName: { fontSize: "18pt", fontWeight: 700, color: "#0f172a" },
    clinicTitle: { fontSize: "10pt", fontWeight: 700, color: "#0e7490" },
    clinicDetail: { fontSize: "8pt", fontWeight: 400, color: "#64748b", whiteSpace: "pre-line" },
    bodyPad: "8mm 16mm",
    bodyText: "#1a2430",
    mutedText: "#64748b",
    accent: "#0e7490",
    rxStyle: { fontSize: "17pt", fontWeight: 700, fontStyle: "italic", color: "#0e7490", margin: "2mm 0 3mm" },
    medRowRule: "none",
    signatureRule: "1px solid #94a3b8",
    footerRule: "1px solid #e2e8f0",
    footerMuted: "#94a3b8",
  },
  modern: {
    headerBg: "linear-gradient(135deg, #0e7490 0%, #155e75 100%)",
    headerColor: "#ffffff",
    headerRule: "none",
    headerPad: "10mm 14mm",
    headerMuted: "rgba(255,255,255,0.85)",
    doctorName: { fontSize: "20pt", fontWeight: 700, letterSpacing: "-0.01em", color: "#ffffff" },
    clinicTitle: { fontSize: "10pt", fontWeight: 700, color: "#ffffff" },
    clinicDetail: { fontSize: "8pt", fontWeight: 400, color: "rgba(255,255,255,0.85)", whiteSpace: "pre-line" },
    bodyPad: "8mm 14mm",
    bodyText: "#1a2430",
    mutedText: "#64748b",
    accent: "#0e7490",
    rxStyle: { fontSize: "17pt", fontWeight: 700, fontStyle: "italic", color: "#0e7490", margin: "2mm 0 3mm" },
    medRowRule: "none",
    signatureRule: "1px solid #94a3b8",
    footerRule: "1px solid #e2e8f0",
    footerMuted: "#94a3b8",
  },
  compact: {
    headerBg: "transparent",
    headerColor: "#0f172a",
    headerRule: "2px solid #0e7490",
    headerPad: "10mm 14mm 4mm",
    headerMuted: "#64748b",
    doctorName: { fontSize: "14pt", fontWeight: 700, color: "#0e7490" },
    clinicTitle: { fontSize: "10pt", fontWeight: 700, color: "#0e7490" },
    clinicDetail: { fontSize: "8pt", fontWeight: 400, color: "#64748b", whiteSpace: "pre-line" },
    bodyPad: "8mm 14mm",
    bodyText: "#1a2430",
    mutedText: "#64748b",
    accent: "#0e7490",
    rxStyle: { fontSize: "17pt", fontWeight: 700, fontStyle: "italic", color: "#0e7490", margin: "2mm 0 3mm" },
    medRowRule: "1px solid #e2e8f0",
    signatureRule: "1px solid #94a3b8",
    footerRule: "1px solid #e2e8f0",
    footerMuted: "#94a3b8",
  },
  elegant: {
    headerBg: "transparent",
    headerColor: "#1c1917",
    headerRule: "none",
    headerPad: "12mm 18mm 4mm",
    headerMuted: "#78716c",
    doctorName: { fontSize: "19pt", fontWeight: 600, color: "#1c1917", fontFamily: 'Georgia, "Times New Roman", serif' },
    clinicTitle: { fontSize: "10.5pt", fontWeight: 600, color: "#1c1917", fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: "0.08em", textTransform: "uppercase" },
    clinicDetail: { fontSize: "8pt", fontWeight: 400, color: "#78716c", whiteSpace: "pre-line", fontFamily: 'Georgia, "Times New Roman", serif' },
    bodyPad: "8mm 18mm",
    bodyText: "#292524",
    mutedText: "#78716c",
    accent: "#9a3412",
    rxStyle: { fontSize: "18pt", fontWeight: 600, fontStyle: "italic", color: "#9a3412", margin: "2mm 0 3mm", fontFamily: 'Georgia, "Times New Roman", serif' },
    medRowRule: "none",
    adviceLabel: { fontFamily: 'Georgia, "Times New Roman", serif', letterSpacing: "0.14em" },
    signatureRule: "1px solid #a8a29e",
    footerRule: "2px solid #1c1917",
    footerMuted: "#a8a29e",
    centeredHeader: true,
  },
  minimal: {
    headerBg: "transparent",
    headerColor: "#111827",
    headerRule: "none",
    headerPad: "14mm 18mm 2mm",
    headerMuted: "#9ca3af",
    doctorName: { fontSize: "15pt", fontWeight: 600, color: "#111827", letterSpacing: "-0.01em" },
    clinicTitle: { fontSize: "9pt", fontWeight: 500, color: "#111827", letterSpacing: "0.04em" },
    clinicDetail: { fontSize: "7.5pt", fontWeight: 400, color: "#9ca3af", whiteSpace: "pre-line" },
    bodyPad: "10mm 18mm",
    bodyText: "#1f2937",
    mutedText: "#9ca3af",
    accent: "#111827",
    rxStyle: { fontSize: "14pt", fontWeight: 600, color: "#111827", margin: "3mm 0 4mm", letterSpacing: "0.02em" },
    medRowRule: "none",
    adviceLabel: { color: "#111827" },
    signatureRule: "1px solid #d1d5db",
    footerRule: "none",
    footerMuted: "#d1d5db",
    centeredHeader: true,
  },
  bold: {
    headerBg: "#0f172a",
    headerColor: "#ffffff",
    headerRule: "4px solid #f59e0b",
    headerPad: "9mm 14mm",
    headerMuted: "rgba(255,255,255,0.75)",
    doctorName: { fontSize: "21pt", fontWeight: 800, color: "#ffffff", textTransform: "uppercase", letterSpacing: "0.01em" },
    clinicTitle: { fontSize: "10pt", fontWeight: 800, color: "#f59e0b", textTransform: "uppercase", letterSpacing: "0.06em" },
    clinicDetail: { fontSize: "8pt", fontWeight: 500, color: "rgba(255,255,255,0.75)", whiteSpace: "pre-line" },
    bodyPad: "8mm 14mm",
    bodyText: "#1e293b",
    mutedText: "#64748b",
    accent: "#d97706",
    rxStyle: { fontSize: "18pt", fontWeight: 800, color: "#d97706", margin: "2mm 0 3mm", textTransform: "uppercase", fontStyle: "normal" },
    medRowRule: "none",
    adviceLabel: { color: "#d97706" },
    signatureRule: "2px solid #0f172a",
    footerRule: "none",
    footerMuted: "#cbd5e1",
    invertHeader: true,
  },
  watermark: {
    headerBg: "transparent",
    headerColor: "#134e4a",
    headerRule: "1px solid #99f6e4",
    headerPad: "11mm 16mm 6mm",
    headerMuted: "#5eead4",
    doctorName: { fontSize: "18pt", fontWeight: 700, color: "#134e4a" },
    clinicTitle: { fontSize: "10pt", fontWeight: 700, color: "#0d9488" },
    clinicDetail: { fontSize: "8pt", fontWeight: 400, color: "#5eead4", whiteSpace: "pre-line" },
    bodyPad: "8mm 16mm",
    bodyText: "#134e4a",
    mutedText: "#64748b",
    accent: "#0d9488",
    rxStyle: { fontSize: "17pt", fontWeight: 700, fontStyle: "italic", color: "#0d9488", margin: "2mm 0 3mm" },
    medRowRule: "none",
    signatureRule: "1px solid #94a3b8",
    footerRule: "1px solid #e2e8f0",
    footerMuted: "#94a3b8",
  },
  "two-column": {
    headerBg: "transparent",
    headerColor: "#0f172a",
    headerRule: "2px solid #0e7490",
    headerPad: "8mm 12mm 5mm",
    headerMuted: "#64748b",
    doctorName: { fontSize: "16pt", fontWeight: 700, color: "#0f172a" },
    clinicTitle: { fontSize: "9pt", fontWeight: 700, color: "#0e7490" },
    clinicDetail: { fontSize: "7pt", fontWeight: 400, color: "#64748b", whiteSpace: "pre-line" },
    bodyPad: "0",
    bodyText: "#1a2430",
    mutedText: "#64748b",
    accent: "#0e7490",
    rxStyle: { fontSize: "11pt", fontWeight: 700, color: "#0f172a", margin: "2mm 0 2mm" },
    medRowRule: "1px solid #e2e8f0",
    adviceLabel: { fontWeight: 700, color: "#0f172a", marginBottom: "1mm" },
    signatureRule: "1px solid #94a3b8",
    footerRule: "1px solid #e2e8f0",
    footerMuted: "#94a3b8",
  },
};

/** Exported template registry so the bundler keeps every template branch
 *  alive in the build output (tree-shaking). The two-column body below is
 *  only referenced through the runtime `data.template` guard, so the
 *  template objects and `TwoColumnSheet` must be reachable from a stable
 *  module-level symbol to avoid being elided.
 */
export const PRESCRIPTION_TEMPLATES_BY_ID: Record<PrescriptionTemplate, TemplateStyle> = TEMPLATES;

export const PRESCRIPTION_TEMPLATE_REGISTRY = Object.freeze(
  PRESCRIPTION_TEMPLATES.reduce((acc, t) => {
    acc[t.id] = t.id;
    return acc;
  }, {} as Record<PrescriptionTemplate, PrescriptionTemplate>),
);

/** Two-column body: header + left clinical stack + right Rx list + footer. */
export function TwoColumnSheet({ data }: { data: PrescriptionSheetData }) {
  const doctorLabel = data.doctor_name.startsWith("Dr") ? data.doctor_name : `Dr. ${data.doctor_name}`;
  const title = data.clinic_name || "Dental Practice";
  const contactParts = [data.clinic_address, data.clinic_phone].filter(Boolean);
  const GREEN = "#0e7490";
  const GREEN_DARK = "#0b4f6c";
  const sideLabel = {
    fontSize: "9.5pt",
    fontWeight: 700,
    color: "#374151",
    marginBottom: "1.5mm",
  };
  const sideValue = {
    fontSize: "9pt",
    color: "#1f2937",
    whiteSpace: "pre-line",
    lineHeight: 1.4,
  };
  return (
    <div
      style={{
        ...BASE_PAGE,
        fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
        display: "flex",
        flexDirection: "column",
      }}
      data-template="two-column"
    >
      {/* Letterhead */}
      <div
        style={{
          background: "transparent",
          color: "white",
          borderBottom: `2px solid ${GREEN}`,
          padding: "5mm 8mm",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8mm" }}>
          <div>
            <div style={{ ...BASE_PAGE, ...TEMPLATES["two-column"].doctorName }}>{doctorLabel}</div>
            <div style={{ ...TEMPLATES["two-column"].clinicTitle, marginTop: "1mm" }}>{title}</div>
          </div>
          <div>
            {contactParts.map((part, i) => (
              <div key={i} style={TEMPLATES["two-column"].clinicDetail}>{part}</div>
            ))}
          </div>
        </div>
      </div>

      {/* Body: two-column layout — left clinical stack, right Rx list. */}
      <div style={{ display: "flex", gap: "10mm", padding: "4mm 8mm", flex: 1, minHeight: 0 }}>
        {/* Left clinical stack */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8mm", minWidth: 0 }}>
          {data.diagnosis && (
            <div>
              <div style={sideLabel}>Complaints</div>
              <div style={sideValue}>{data.diagnosis}</div>
            </div>
          )}
          {data.on_examination && (
            <div>
              <div style={sideLabel}>On Examination (O/E)</div>
              <div style={sideValue}>{data.on_examination}</div>
            </div>
          )}
          {data.advice && (
            <div>
              <div style={sideLabel}>Advices</div>
              <div style={sideValue}>{data.advice}</div>
            </div>
          )}
          {data.patient_age && (
            <div>
              <div style={sideLabel}>Patient</div>
              <div style={sideValue}>{data.patient_name} · Age {data.patient_age} · DOB: {data.issued_date}</div>
            </div>
          )}
          {data.patient_medical_alerts && (
            <div>
              <div style={sideLabel}>Medical Alerts</div>
              <div style={sideValue}>{data.patient_medical_alerts}</div>
            </div>
          )}
        </div>

        {/* Right Rx list */}
        <div style={{ flex: 1.4, display: "flex", flexDirection: "column", gap: "3mm", minWidth: 0 }}>
          <div style={{ ...TEMPLATES["two-column"].rxStyle, marginTop: "1mm" }}>℞</div>
          {data.items.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: "10pt" }}>No medications.</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11pt" }}>
              <tbody>
                {data.items.map((item, i) => (
                  <tr key={i}>
                    <td style={{ width: "10mm", verticalAlign: "top", color: GREEN, fontWeight: 700, padding: "1.5mm 0" }}>
                      {i + 1}.
                    </td>
                    <td style={{ verticalAlign: "top", padding: "1.5mm 0", fontSize: "10.5pt" }}>
                      <div style={{ fontWeight: 700 }}>
                        {item.drug_name}
                        {item.dosage ? <span style={{ fontWeight: 400 }}> {item.dosage}</span> : null}
                      </div>
                      <div style={{ fontSize: "9.5pt", color: "#374151", marginTop: "1mm" }}>
                        {item.frequency} · {item.duration ? `Duration: ${item.duration}` : null}
                        {item.instructions ? ` · ${item.instructions}` : ""}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {data.follow_up && (
            <div style={{ marginTop: "auto", fontSize: "9pt", color: "#6b7280" }}>
              <span style={{ color: "#374151", fontWeight: 700 }}>Follow-up: </span>
              {data.follow_up}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          background: "#f1f5f9",
          borderTop: `1px solid #e2e8f0`,
          padding: "3mm 8mm",
          display: "flex",
          justifyContent: "space-between",
          gap: "8mm",
          fontSize: "7.5pt",
          color: "#6b7280",
          lineHeight: 1.4,
        }}
      >
        <div>
          {title}
          {contactParts.length > 0 ? ` — ${contactParts.join(" · ")}` : ""}
          {data.chamber_footer_instructions && (
            <div
              style={{
                marginTop: "1mm",
                paddingTop: "1mm",
                borderTop: "1px solid #e2e8f0",
                whiteSpace: "pre-line",
                fontSize: "7pt",
                color: "#94a3b8",
              }}
            >
              {data.chamber_footer_instructions}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 700, color: GREEN_DARK, marginBottom: "1mm" }}>Follow-up: {data.follow_up ?? "—"}</div>
          <div style={{ display: "flex", gap: "4mm", justifyContent: "flex-end" }}>
            <span style={{ fontWeight: 700, color: GREEN }}>[Print / Save PDF]</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The clinic logo, normalized for print: `<img>` with a fixed box and
 * object-contain so any aspect ratio fits without distorting. Data URLs are
 * self-contained — the print iframe and public page need no extra requests.
 */
function LetterheadLogo({ src, heightMm }: { src: string; heightMm: number }) {
  return (
    <img
      src={src}
      alt=""
      style={{
        height: `${heightMm}mm`,
        maxWidth: "55mm",
        objectFit: "contain",
        display: "block",
      }}
    />
  );
}

/** Shared tooth glyph for watermarks. */
const TOOTH_PATH =
  "M12 2C8.5 2 7 4.5 7 8c0 2.2.4 3.4.4 5.2 0 1.9-.9 4.6-.9 6.3 0 1.4.8 2.5 2 2.5 1.6 0 2-2.3 2.6-4.6.3-1.2.5-1.9.9-1.9s.6.7.9 1.9c.6 2.3 1 4.6 2.6 4.6 1.2 0 2-1.1 2-2.5 0-1.7-.9-4.4-.9-6.3C16.6 11.4 17 10.2 17 8c0-3.5-1.5-6-5-6Z";

/** Decorative background layer (watermark template only). */
export function Watermark() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      style={{
        position: "absolute",
        right: "-30mm",
        bottom: "10mm",
        width: "150mm",
        height: "150mm",
        color: "rgba(13, 148, 136, 0.06)",
        fill: "currentColor",
        pointerEvents: "none",
      }}
    >
      <path d={TOOTH_PATH} />
    </svg>
  );
}

/**
 * Chamber-pad template: the South Asian dental chamber style — green
 * three-part letterhead, a patient bar, a pale-blue clinical sidebar
 * (C/C, O/E, H/O, Treatment Plan, X-ray) beside a white ℞ panel with a
 * center watermark and signature block, and a green advice footer.
 * Prompt labels that the app has no data for still render (like the printed
 * pad), so the sheet doubles as a handwriting form.
 */
export function ChamberSheet({ data }: { data: PrescriptionSheetData }) {
  const doctorLabel = data.doctor_name.startsWith("Dr") ? data.doctor_name : `Dr. ${data.doctor_name}`;
  const title = data.clinic_name || "Dental Practice";
  const contactParts = [data.clinic_address, data.clinic_phone].filter(Boolean);
  const GREEN = "#166534";
  const GREEN_DARK = "#14532d";

  // Bengali labels, matching the printed chamber pad. Bangla needs its own
  // font stack — falls back through the commonly installed Noto/system Bangla
  // fonts before generic sans-serif.
  const BN_FONT = "'Noto Sans Bengali', 'Hind Siliguri', 'SolaimanLipi', 'Kalpurush', 'Vrinda', system-ui, sans-serif";
  const bnName: React.CSSProperties = { fontFamily: BN_FONT, fontSize: "9.5pt", fontWeight: 700, color: GREEN_DARK };
  const bnDetail: React.CSSProperties = { fontFamily: BN_FONT, fontSize: "8pt", color: "#3f5147", lineHeight: 1.4 };
  const bnSub: React.CSSProperties = { fontFamily: BN_FONT, fontSize: "8pt", fontWeight: 400, color: "#64748b" };

  const sideLabel: React.CSSProperties = {
    fontSize: "10.5pt",
    fontWeight: 600,
    color: "#374151",
    marginBottom: "2mm",
  };
  const sideValue: React.CSSProperties = {
    fontSize: "9.5pt",
    color: "#1f2937",
    whiteSpace: "pre-line",
    lineHeight: 1.45,
  };
  const headValue: React.CSSProperties = { fontSize: "9pt", color: "#1f2937" };

  return (
    <div style={{ ...BASE_PAGE, fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif' }} data-template="chamber">
      {/* ── Letterhead ─────────────────────────────────────── */}
      <div
        style={{
          borderTop: `2.5mm solid ${GREEN_DARK}`,
          background: "linear-gradient(90deg, #dcead2 0%, #eaf3e2 55%, #f4f8ee 100%)",
          borderBottom: `2px solid ${GREEN}`,
          padding: "4mm 8mm 3mm",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: "5mm",
          alignItems: "center",
        }}
      >
        {/* Left: Bengali dentist block — the printed pad's Bangla side,
            mirroring the English block on the right. */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.2mm" }}>
          <div style={bnName}>ডেন্টিস্ট : {doctorLabel}</div>
          {data.doctor_specialty && <div style={bnDetail}>{data.doctor_specialty}</div>}
          {data.doctor_license && <div style={bnDetail}>লাইসেন্স : {data.doctor_license}</div>}
          {data.clinic_phone && <div style={bnDetail}>মোবাইল : {data.clinic_phone}</div>}
          {data.clinic_address && <div style={bnDetail}>চেম্বার : {data.clinic_address}</div>}
        </div>

        {/* Center: logo + clinic name */}
        <div style={{ textAlign: "center" }}>
          {data.clinic_logo && (
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1.5mm" }}>
              <LetterheadLogo src={data.clinic_logo} heightMm={11} />
            </div>
          )}
          <div style={{ fontSize: "14pt", fontWeight: 800, color: GREEN_DARK, letterSpacing: "0.01em" }}>{title}</div>
          {data.doctor_specialty && (
            <div style={{ fontSize: "7.5pt", color: "#3f6212", marginTop: "0.5mm" }}>{data.doctor_specialty}</div>
          )}
        </div>

        {/* Right: doctor block */}
        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "1.2mm" }}>
          <div style={{ fontSize: "13.5pt", fontWeight: 700, color: GREEN_DARK }}>{doctorLabel}</div>
          {data.doctor_license && <div style={headValue}>License {data.doctor_license}</div>}
          {data.clinic_phone && <div style={headValue}>Mobile : {data.clinic_phone}</div>}
        </div>
      </div>

      {/* ── Patient bar ────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "14mm",
          padding: "3.5mm 8mm",
          borderBottom: `2px solid ${GREEN}`,
          fontSize: "10pt",
          color: "#1f2937",
        }}
      >
        <div style={{ flex: 1 }}>
          <span style={{ color: "#6b7280" }}>Name : </span>
          <strong>{data.patient_name}</strong>
          {data.patient_medical_alerts && (
            <span style={{ marginLeft: "4mm", color: "#b45309", fontWeight: 600, fontSize: "8.5pt" }}>
              ⚠ {data.patient_medical_alerts}
            </span>
          )}
        </div>
        <div style={{ width: "30mm" }}>
          <span style={{ color: "#6b7280" }}>Patient ID : </span>
          {data.patient_id ?? ""}
        </div>
        <div style={{ width: "22mm" }}>
          <span style={{ color: "#6b7280" }}>Gender : </span>
          {data.patient_gender ?? ""}
        </div>
        <div style={{ width: "28mm" }}>
          <span style={{ color: "#6b7280" }}>Age : </span>
          {data.patient_age ?? ""}
        </div>
        <div style={{ width: "30mm" }}>
          <span style={{ color: "#6b7280" }}>Date : </span>
          {formatDate(data.issued_date)}
        </div>
      </div>

      {/* ── Body: clinical sidebar + ℞ panel ───────────────── */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Sidebar */}
        <div
          style={{
            width: "27%",
            background: "#dfeaf3",
            borderRight: "1px solid #b6c8d8",
            padding: "7mm 5mm",
            display: "flex",
            flexDirection: "column",
            gap: "9mm",
          }}
        >
          <div>
            <div style={sideLabel}>C/C : <span style={bnSub}>রোগের বর্ণনা</span></div>
            {data.diagnosis && <div style={sideValue}>{data.diagnosis}</div>}
          </div>
          <div>
            <div style={sideLabel}>O/E : <span style={bnSub}>পরীক্ষায় প্রাপ্ত</span></div>
            {data.on_examination && <div style={sideValue}>{data.on_examination}</div>}
            {data.tooth && <div style={sideValue}>Tooth {data.tooth}</div>}
            {data.practitioner_name && data.practitioner_name !== data.doctor_name && (
              <div style={{ ...sideValue, color: "#6b7280" }}>Seen by {data.practitioner_name}</div>
            )}
          </div>
          <div>
            <div style={sideLabel}>H/O: <span style={bnSub}>রোগের ইতিহাস</span></div>
            {data.history && <div style={sideValue}>{data.history}</div>}
            {data.patient_medical_alerts && <div style={sideValue}>{data.patient_medical_alerts}</div>}
          </div>
          <div>
            <div style={sideLabel}>Treatment Plan <span style={bnSub}>চিকিৎসা পরিকল্পনা</span></div>
            {data.plan_treatment_name && <div style={sideValue}>{data.plan_treatment_name}</div>}
          </div>
          <div>
            <div style={sideLabel}>Complaints <span style={bnSub}>কারণ / শিকয়ত</span></div>
            {data.complaints && data.complaints.items.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5mm" }}>
                {data.complaints.items.map((c, i) => (
                  <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "1mm", alignItems: "baseline" }}>
                    <span style={{ fontWeight: 600, color: "#1f2937" }}>{c.label}</span>
                    {c.duration && <span style={{ color: "#6b7280", fontSize: "8.5pt" }}>· {c.duration}</span>}
                    {c.site && <span style={{ color: "#6b7280", fontSize: "8.5pt" }}>· {c.site}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={sideLabel}>Investigations <span style={bnSub}>পরীক্ষা</span></div>
            {data.investigations && data.investigations.items.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1mm" }}>
                {data.investigations.items.map((inv, i) => (
                  <div key={i} style={{ ...sideValue, display: "flex", justifyContent: "space-between", gap: "3mm" }}>
                    <span>{inv.label}</span>
                    {inv.result ? <span style={{ color: "#0e7490" }}>{inv.result}</span> : <span style={{ color: "#9ca3af" }}>ordered</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div>
            <div style={sideLabel}>Vitals <span style={bnSub}>স্বাস্থ্য তথ্য</span></div>
            {(data.vitals?.bp || data.vitals?.temperature || data.vitals?.pulse || data.vitals?.spo2) && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1mm" }}>
                {data.vitals?.bp && <div style={sideValue}>Blood pressure : {data.vitals.bp} mmHg</div>}
                {data.vitals?.temperature && <div style={sideValue}>Temperature : {data.vitals.temperature}</div>}
                {data.vitals?.pulse && <div style={sideValue}>Pulse : {data.vitals.pulse}</div>}
                {data.vitals?.spo2 && <div style={sideValue}>SpO₂ : {data.vitals.spo2}</div>}
              </div>
            )}
          </div>
          <div>
            <div style={sideLabel}>X-ray <span style={bnSub}>এক্স-রে</span></div>
            {data.images && data.images.some((i) => i.src) ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "2mm" }}>
                {data.images
                  .filter((i) => i.src)
                  .map((i) => (
                    <img
                      key={i.id}
                      src={i.src!}
                      alt={i.label || "X-ray"}
                      style={{ width: "100%", border: "1px solid #9db7c9", borderRadius: "1mm", background: "#ffffff" }}
                    />
                  ))}
              </div>
            ) : (
              <svg width="58" height="58" viewBox="0 0 58 58" aria-hidden style={{ marginTop: "1mm" }}>
                <path d="M29 6v46M6 29h46" stroke="#4a7fa5" strokeWidth="1.2" fill="none" />
              </svg>
            )}
          </div>
        </div>

        {/* ℞ panel */}
        <div style={{ flex: 1, position: "relative", padding: "6mm 8mm", display: "flex", flexDirection: "column", background: "#ffffff" }}>
          {/* Center watermark: clinic logo, or the tooth glyph */}
          <div
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            {data.clinic_logo ? (
              <img src={data.clinic_logo} alt="" style={{ width: "90mm", opacity: 0.1, objectFit: "contain" }} />
            ) : (
              <svg viewBox="0 0 24 24" style={{ width: "100mm", color: "rgba(22, 101, 52, 0.07)", fill: "currentColor" }}>
                <path d={TOOTH_PATH} />
              </svg>
            )}
          </div>

          <div style={{ ...TEMPLATES.chamber.rxStyle, position: "relative" }}>℞</div>

          <div style={{ position: "relative" }}>
            {data.items.length === 0 ? (
              <div style={{ color: "#94a3b8", fontSize: "10pt" }}>No medications.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "11pt" }}>
                <tbody>
                  {data.items.map((item, i) => (
                    <tr key={i}>
                      <td style={{ width: "8mm", verticalAlign: "top", color: GREEN, fontWeight: 700, padding: "2.5mm 0" }}>
                        {i + 1}.
                      </td>
                      <td style={{ verticalAlign: "top", padding: "2.5mm 0" }}>
                        <div style={{ fontWeight: 700 }}>
                          {item.drug_name}
                          {item.generic_name ? <span style={{ fontWeight: 400, fontStyle: "italic", color: "#6b7280" }}> ({item.generic_name})</span> : null}
                          {item.dosage ? <span style={{ fontWeight: 400 }}> {item.dosage}</span> : null}
                        </div>
                        <div style={{ fontSize: "9.5pt", color: "#374151", marginTop: 1 }}>
                          {[
                        item.schedule ? (DOSE_SCHEDULE_LABELS as Record<string, string>)[item.schedule] : null,
                        item.frequency,
                        item.meal_relation ? (MEAL_RELATION_LABELS as Record<string, string>)[item.meal_relation] : null,
                            item.duration ? `for ${item.duration}` : null,
                            item.instructions,
                          ].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {data.advice && (
              <div style={{ marginTop: "6mm", fontSize: "9.5pt", lineHeight: 1.45 }}>
                <div style={{ fontWeight: 700, color: GREEN, fontSize: "8.5pt", letterSpacing: "0.05em", marginBottom: 1 }}>ADVICE</div>
                <div style={{ whiteSpace: "pre-line" }}>{data.advice}</div>
              </div>
            )}
            {(data.follow_up || data.follow_up_date) && (
              <div style={{ marginTop: "4mm", fontSize: "9.5pt", color: "#1f2937" }}>
                <span style={{ color: "#6b7280" }}>Follow-up: </span>
                {data.follow_up_date ? (
                  <>{data.follow_up} {data.follow_up_date ? `· ${formatDate(data.follow_up_date)}` : ""}</>
                ) : (
                  data.follow_up
                )
                }
              </div>
            )}
          </div>

          {/* Payment QR */}
          {data.payment_qr && (
            <div style={{ marginTop: "4mm", display: "flex", justifyContent: "flex-end", gap: "2mm", alignItems: "center" }}>
              <img
                src={data.payment_qr}
                alt={data.payment_qr_label || "Payment QR"}
                style={{ width: "22mm", height: "22mm", objectFit: "contain", border: "1px solid #d1d5db" }}
              />
              {data.payment_qr_label && (
                <div style={{ fontSize: "8pt", color: "#6b7280", lineHeight: 1.3 }}>
                  {data.payment_qr_label}
                </div>
              )}
            </div>
          )}

          {/* Signature */}
          <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", position: "relative" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ borderTop: "1px solid #9ca3af", width: "46mm", paddingTop: "1.5mm", fontSize: "9.5pt", color: "#374151" }}>
                Signature
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────── */}
      <div
        style={{
          background: "#eef6ea",
          borderTop: `2px solid ${GREEN}`,
          padding: "3mm 8mm",
          display: "flex",
          justifyContent: "space-between",
          gap: "8mm",
          fontSize: "7.5pt",
          color: GREEN,
          lineHeight: 1.4,
        }}
      >
        <div>
          {title}
          {contactParts.length > 0 ? ` — ${contactParts.join(" · ")}` : ""}
          {data.chamber_footer_instructions && (
            <div
              style={{
                marginTop: "1.5mm",
                paddingTop: "1.5mm",
                borderTop: "1px solid rgba(22, 101, 52, 0.25)",
                whiteSpace: "pre-line",
                fontSize: "7pt",
                color: "#3f5147",
              }}
            >
              {data.chamber_footer_instructions}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", fontWeight: 600 }}>
          {doctorLabel}
          {data.doctor_qualifications ? ` · ${data.doctor_qualifications}` : ""}
          {data.doctor_license ? ` · License ${data.doctor_license}` : ""}
        </div>
      </div>
    </div>
  );
}

// ── Practice-defined templates (Settings → Rx templates) ────────────
//
// A custom template is data, not code: the doctor saves an RxTemplateConfig
// (layout, palette, typography, which clinical blocks print) and CustomSheet
// renders it. Two structures: "sidebar" is the chamber pad (clinical column
// beside the ℞ panel), "stacked" is a full-width page.

const CUSTOM_SANS = 'Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
const CUSTOM_SERIF = 'Georgia, "Times New Roman", serif';
const CUSTOM_BN = "'Noto Sans Bengali', 'Hind Siliguri', 'SolaimanLipi', 'Kalpurush', 'Vrinda', system-ui, sans-serif";

const SECTION_LABELS: Record<RxSheetSectionKey, string> = {
  diagnosis: "C/C",
  on_examination: "O/E",
  history: "H/O",
  treatment_plan: "Treatment Plan",
  complaints: "Complaints",
  investigations: "Investigations",
  vitals: "Vitals",
  xray: "X-ray",
};

const SECTION_BANGLA: Record<RxSheetSectionKey, string> = {
  diagnosis: "রোগের বর্ণনা",
  on_examination: "পরীক্ষায় প্রাপ্ত",
  history: "রোগের ইতিহাস",
  treatment_plan: "চিকিৎসা পরিকল্পনা",
  complaints: "কারণ / শিকয়ত",
  investigations: "পরীক্ষা",
  vitals: "স্বাস্থ্য তথ্য",
  xray: "এক্স-রে",
};

/** Medication list shared by both custom structures. */
function CustomMedList({ data, accent, L }: { data: PrescriptionSheetData; accent: string; L: number }) {
  if (data.items.length === 0) {
    return <div style={{ color: "#94a3b8", fontSize: `${10 * L}pt` }}>No medications.</div>;
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: `${11 * L}pt` }}>
      <tbody>
        {data.items.map((item, i) => (
          <tr key={i}>
            <td style={{ width: "8mm", verticalAlign: "top", color: accent, fontWeight: 700, padding: `${2.2 * L}mm 0` }}>
              {i + 1}.
            </td>
            <td style={{ verticalAlign: "top", padding: `${2.2 * L}mm 0` }}>
              <div style={{ fontWeight: 700 }}>
                {item.drug_name}
                {item.generic_name ? (
                  <span style={{ fontWeight: 400, fontStyle: "italic", color: "#6b7280" }}> ({item.generic_name})</span>
                ) : null}
                {item.dosage ? <span style={{ fontWeight: 400 }}> {item.dosage}</span> : null}
              </div>
              <div style={{ fontSize: `${9.5 * L}pt`, color: "#374151", marginTop: 1 }}>
                {[
                  item.schedule ? (DOSE_SCHEDULE_LABELS as Record<string, string>)[item.schedule] : null,
                  item.frequency,
                  item.meal_relation ? (MEAL_RELATION_LABELS as Record<string, string>)[item.meal_relation] : null,
                  item.duration ? `for ${item.duration}` : null,
                  item.instructions,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A practice-defined template rendered from its saved config. */
export function CustomSheet({ data, config }: { data: PrescriptionSheetData; config: RxTemplateConfig }) {
  const doctorLabel = data.doctor_name.startsWith("Dr") ? data.doctor_name : `Dr. ${data.doctor_name}`;
  const title = data.clinic_name || "Dental Practice";
  const contactParts = [data.clinic_address, data.clinic_phone].filter(Boolean);
  const L = data.large_print ? 1.45 : 1;
  const accent = config.accent;
  const font = config.font === "serif" ? CUSTOM_SERIF : CUSTOM_SANS;
  const rule = config.show_rule ? `2px solid ${accent}` : "none";
  const tint = `${accent}14`;
  const sidebar = config.layout === "sidebar";
  const sections = (config.sections ?? []).filter((s) => s.enabled);

  const sideLabel: React.CSSProperties = { fontSize: "10.5pt", fontWeight: 600, color: "#374151", marginBottom: "2mm" };
  const sideValue: React.CSSProperties = { fontSize: "9.5pt", color: "#1f2937", whiteSpace: "pre-line", lineHeight: 1.45 };
  const bnSub: React.CSSProperties = { fontFamily: CUSTOM_BN, fontSize: "8pt", fontWeight: 400, color: "#64748b" };
  const hasVitals = Boolean(data.vitals?.bp || data.vitals?.temperature || data.vitals?.pulse || data.vitals?.spo2);

  /** Whether a block has anything to print. The stacked page drops empty rows
   *  (a commercial sheet), while the sidebar keeps its headings as a pad form. */
  function sectionHasData(key: RxSheetSectionKey): boolean {
    switch (key) {
      case "diagnosis":
        return Boolean(data.diagnosis);
      case "on_examination":
        return Boolean(data.on_examination || data.tooth || (data.practitioner_name && data.practitioner_name !== data.doctor_name));
      case "history":
        return Boolean(data.history || data.patient_medical_alerts);
      case "treatment_plan":
        return Boolean(data.plan_treatment_name);
      case "complaints":
        return Boolean(data.complaints?.items.length);
      case "investigations":
        return Boolean(data.investigations?.items.length);
      case "vitals":
        return hasVitals;
      case "xray":
        return Boolean(data.images?.some((i) => i.src));
    }
  }

  /** Body of one clinical block. Empty blocks still print their heading, so the
   *  sheet doubles as a handwriting form (the chamber-pad convention). */
  function sectionBody(key: RxSheetSectionKey) {
    switch (key) {
      case "diagnosis":
        return data.diagnosis ? <div style={sideValue}>{data.diagnosis}</div> : null;
      case "on_examination":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "1mm" }}>
            {data.on_examination && <div style={sideValue}>{data.on_examination}</div>}
            {data.tooth && <div style={sideValue}>Tooth {data.tooth}</div>}
            {data.practitioner_name && data.practitioner_name !== data.doctor_name && (
              <div style={{ ...sideValue, color: "#6b7280" }}>Seen by {data.practitioner_name}</div>
            )}
          </div>
        );
      case "history":
        return (
          <div style={{ display: "flex", flexDirection: "column", gap: "1mm" }}>
            {data.history && <div style={sideValue}>{data.history}</div>}
            {data.patient_medical_alerts && (
              <div style={{ ...sideValue, color: "#b45309" }}>{data.patient_medical_alerts}</div>
            )}
          </div>
        );
      case "treatment_plan":
        return data.plan_treatment_name ? <div style={sideValue}>{data.plan_treatment_name}</div> : null;
      case "complaints":
        return data.complaints && data.complaints.items.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5mm" }}>
            {data.complaints.items.map((c, i) => (
              <div key={i} style={{ display: "flex", flexWrap: "wrap", gap: "1mm", alignItems: "baseline" }}>
                <span style={{ fontWeight: 600, color: "#1f2937" }}>{c.label}</span>
                {c.duration && <span style={{ color: "#6b7280", fontSize: "8.5pt" }}>· {c.duration}</span>}
                {c.site && <span style={{ color: "#6b7280", fontSize: "8.5pt" }}>· {c.site}</span>}
              </div>
            ))}
          </div>
        ) : null;
      case "investigations":
        return data.investigations && data.investigations.items.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1mm" }}>
            {data.investigations.items.map((inv, i) => (
              <div key={i} style={{ ...sideValue, display: "flex", justifyContent: "space-between", gap: "3mm" }}>
                <span>{inv.label}</span>
                {inv.result ? <span style={{ color: accent }}>{inv.result}</span> : <span style={{ color: "#9ca3af" }}>ordered</span>}
              </div>
            ))}
          </div>
        ) : null;
      case "vitals":
        return hasVitals ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "1mm" }}>
            {data.vitals?.bp && <div style={sideValue}>Blood pressure : {data.vitals.bp} mmHg</div>}
            {data.vitals?.temperature && <div style={sideValue}>Temperature : {data.vitals.temperature}</div>}
            {data.vitals?.pulse && <div style={sideValue}>Pulse : {data.vitals.pulse}</div>}
            {data.vitals?.spo2 && <div style={sideValue}>SpO₂ : {data.vitals.spo2}</div>}
          </div>
        ) : null;
      case "xray":
        return data.images && data.images.some((i) => i.src) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "2mm" }}>
            {data.images
              .filter((i) => i.src)
              .map((i) => (
                <img
                  key={i.id}
                  src={i.src!}
                  alt={i.label || "X-ray"}
                  style={{ width: "100%", border: "1px solid #cbd5e1", borderRadius: "1mm", background: "#ffffff" }}
                />
              ))}
          </div>
        ) : (
          <svg width="52" height="52" viewBox="0 0 58 58" aria-hidden style={{ marginTop: "1mm" }}>
            <path d="M29 6v46M6 29h46" stroke={accent} strokeWidth="1.2" fill="none" opacity="0.55" />
          </svg>
        );
    }
  }

  const watermark = config.show_watermark ? (
    <div
      aria-hidden
      style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}
    >
      {data.clinic_logo ? (
        <img src={data.clinic_logo} alt="" style={{ width: "85mm", opacity: 0.08, objectFit: "contain" }} />
      ) : (
        <svg viewBox="0 0 24 24" style={{ width: "95mm", color: `${accent}12`, fill: "currentColor" }}>
          <path d={TOOTH_PATH} />
        </svg>
      )}
    </div>
  ) : null;

  const adviceBlock = data.advice ? (
    <div style={{ marginTop: `${5 * L}mm`, fontSize: `${9.5 * L}pt`, lineHeight: 1.45 }}>
      <div style={{ fontWeight: 700, color: accent, fontSize: `${8.5 * L}pt`, letterSpacing: "0.05em", marginBottom: 1 }}>
        ADVICE
      </div>
      <div style={{ whiteSpace: "pre-line" }}>{data.advice}</div>
    </div>
  ) : null;

  const followUpBlock =
    data.follow_up || data.follow_up_date ? (
      <div style={{ marginTop: "4mm", fontSize: `${9.5 * L}pt`, color: "#1f2937" }}>
        <span style={{ color: "#6b7280" }}>Follow-up: </span>
        {data.follow_up_date ? (
          <>
            {data.follow_up} · {formatDate(data.follow_up_date)}
          </>
        ) : (
          data.follow_up
        )}
      </div>
    ) : null;

  const qrBlock = data.payment_qr ? (
    <div style={{ marginTop: "4mm", display: "flex", justifyContent: "flex-end", gap: "2mm", alignItems: "center" }}>
      <img
        src={data.payment_qr}
        alt={data.payment_qr_label || "Payment QR"}
        style={{ width: "22mm", height: "22mm", objectFit: "contain", border: "1px solid #d1d5db" }}
      />
      {data.payment_qr_label && (
        <div style={{ fontSize: "8pt", color: "#6b7280", lineHeight: 1.3 }}>{data.payment_qr_label}</div>
      )}
    </div>
  ) : null;

  const signature = config.show_signature ? (
    <div style={{ marginTop: "auto", display: "flex", justifyContent: "flex-end", paddingTop: "6mm" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ borderTop: "1px solid #9ca3af", width: "46mm", paddingTop: "1.5mm", fontSize: "9.5pt", color: "#374151" }}>
          Signature
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div style={{ ...BASE_PAGE, fontFamily: font }} data-template={data.template}>
      {/* ── Letterhead ─────────────────────────────────────── */}
      <div
        style={{
          background: config.header_bg,
          color: config.header_text,
          borderTop: `2.5mm solid ${accent}`,
          borderBottom: rule,
          padding: "4mm 8mm 3mm",
          display: "grid",
          gridTemplateColumns: sidebar && config.show_bangla ? "1fr auto 1fr" : "1fr auto",
          gap: "5mm",
          alignItems: "center",
        }}
      >
        {sidebar && config.show_bangla && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1.2mm" }}>
            <div style={{ fontFamily: CUSTOM_BN, fontSize: "9.5pt", fontWeight: 700 }}>ডেন্টিস্ট : {doctorLabel}</div>
            {data.doctor_specialty && <div style={{ fontFamily: CUSTOM_BN, fontSize: "8pt" }}>{data.doctor_specialty}</div>}
            {data.doctor_license && <div style={{ fontFamily: CUSTOM_BN, fontSize: "8pt" }}>লাইসেন্স : {data.doctor_license}</div>}
            {data.clinic_phone && <div style={{ fontFamily: CUSTOM_BN, fontSize: "8pt" }}>মোবাইল : {data.clinic_phone}</div>}
          </div>
        )}

        <div style={{ textAlign: sidebar && config.show_bangla ? "center" : "left" }}>
          {config.show_logo && data.clinic_logo && (
            <div style={{ display: "flex", justifyContent: sidebar && config.show_bangla ? "center" : "flex-start", marginBottom: "1.5mm" }}>
              <LetterheadLogo src={data.clinic_logo} heightMm={11} />
            </div>
          )}
          <div style={{ fontSize: "14pt", fontWeight: 800, color: config.header_text, letterSpacing: "0.01em" }}>{title}</div>
          {contactParts.length > 0 && (
            <div style={{ fontSize: "7.5pt", marginTop: "0.5mm", opacity: 0.85 }}>{contactParts.join(" · ")}</div>
          )}
        </div>

        <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "1.2mm" }}>
          <div style={{ fontSize: "13pt", fontWeight: 700, color: config.header_text }}>{doctorLabel}</div>
          {data.doctor_qualifications && <div style={{ fontSize: "9pt" }}>{data.doctor_qualifications}</div>}
          {data.doctor_specialty && <div style={{ fontSize: "9pt" }}>{data.doctor_specialty}</div>}
          {data.doctor_license && <div style={{ fontSize: "9pt" }}>License {data.doctor_license}</div>}
        </div>
      </div>

      {/* ── Patient bar ────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          gap: "12mm",
          padding: "3.5mm 8mm",
          borderBottom: rule,
          fontSize: "10pt",
          color: "#1f2937",
        }}
      >
        <div style={{ flex: 1 }}>
          <span style={{ color: "#6b7280" }}>Name : </span>
          <strong>{data.patient_name}</strong>
        </div>
        <div style={{ width: "28mm" }}>
          <span style={{ color: "#6b7280" }}>Patient ID : </span>
          {data.patient_id ?? ""}
        </div>
        <div style={{ width: "22mm" }}>
          <span style={{ color: "#6b7280" }}>Gender : </span>
          {data.patient_gender ?? ""}
        </div>
        <div style={{ width: "26mm" }}>
          <span style={{ color: "#6b7280" }}>Age : </span>
          {data.patient_age ?? ""}
        </div>
        <div style={{ width: "34mm" }}>
          <span style={{ color: "#6b7280" }}>Date : </span>
          {formatDate(data.issued_date)}
        </div>
      </div>

      {sidebar ? (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {sections.length > 0 && (
            <div
              style={{
                width: "27%",
                background: tint,
                borderRight: `1px solid ${accent}33`,
                padding: "7mm 5mm",
                display: "flex",
                flexDirection: "column",
                gap: "7mm",
              }}
            >
              {sections.map((s) => (
                <div key={s.key}>
                  <div style={sideLabel}>
                    {s.label || SECTION_LABELS[s.key]}{" "}
                    {config.show_bangla && <span style={bnSub}>{SECTION_BANGLA[s.key]}</span>}
                  </div>
                  {sectionBody(s.key)}
                </div>
              ))}
            </div>
          )}

          <div style={{ flex: 1, position: "relative", padding: "6mm 8mm", display: "flex", flexDirection: "column" }}>
            {watermark}
            <div style={{ position: "relative", fontSize: "20pt", fontWeight: 700, color: "#1f2937", margin: "1mm 0 2mm" }}>℞</div>
            <div style={{ position: "relative" }}>
              <CustomMedList data={data} accent={accent} L={L} />
              {adviceBlock}
              {followUpBlock}
            </div>
            <div style={{ position: "relative", marginTop: "auto" }}>
              {qrBlock}
              {signature}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, position: "relative", padding: "6mm 14mm", display: "flex", flexDirection: "column" }}>
          {watermark}

          {sections.some((s) => sectionHasData(s.key)) && (
            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "2.5mm", marginBottom: "5mm" }}>
              {sections
                .filter((s) => sectionHasData(s.key))
                .map((s) => (
                  <div
                    key={s.key}
                    style={{ fontSize: "9.5pt", color: "#1f2937", borderBottom: "1px solid #eef2f7", paddingBottom: "1.5mm" }}
                  >
                    <span style={{ color: "#6b7280", fontWeight: 600 }}>{s.label || SECTION_LABELS[s.key]}: </span>
                    {sectionBody(s.key)}
                  </div>
                ))}
            </div>
          )}

          <div style={{ position: "relative", fontSize: "20pt", fontWeight: 700, color: accent, margin: "1mm 0 3mm" }}>℞</div>
          <div style={{ position: "relative" }}>
            <CustomMedList data={data} accent={accent} L={L} />
            {adviceBlock}
            {followUpBlock}
          </div>
          <div style={{ position: "relative", marginTop: "auto" }}>
            {qrBlock}
            {signature}
          </div>
        </div>
      )}

      {/* ── Footer ─────────────────────────────────────────── */}
      <div
        style={{
          background: tint,
          borderTop: rule,
          padding: "3mm 8mm",
          display: "flex",
          justifyContent: "space-between",
          gap: "8mm",
          fontSize: "7.5pt",
          color: accent,
          lineHeight: 1.4,
        }}
      >
        <div>
          {title}
          {contactParts.length > 0 ? ` — ${contactParts.join(" · ")}` : ""}
          {(config.footer_note || data.chamber_footer_instructions) && (
            <div style={{ marginTop: "1.5mm", paddingTop: "1.5mm", borderTop: `1px solid ${accent}33`, whiteSpace: "pre-line", fontSize: "7pt" }}>
              {config.footer_note || data.chamber_footer_instructions}
            </div>
          )}
        </div>
        <div style={{ textAlign: "right", fontWeight: 600 }}>
          {doctorLabel}
          {data.doctor_qualifications ? ` · ${data.doctor_qualifications}` : ""}
        </div>
      </div>
    </div>
  );
}

/** One A4 prescription sheet. Pure presentational — no fetching, no hooks. */
export function PrescriptionSheet({ data }: { data: PrescriptionSheetData }) {
  if (data.template_config) return <CustomSheet data={data} config={data.template_config} />;
  if (data.template === "chamber") return <ChamberSheet data={data} />;
  if (data.template === "two-column") return <TwoColumnSheet data={data} />;

  const t = isPrescriptionTemplate(data.template) ? TEMPLATES[data.template] : TEMPLATES.classic;
  const doctorLabel = data.doctor_name.startsWith("Dr") ? data.doctor_name : `Dr. ${data.doctor_name}`;

  // Large-print mode scales every clinical font size (patient block, ℞,
  // medications, advice, follow-up) — not the letterhead/signature, which the
  // practice writes and the patient never needs to read. 1.45× ≈ 15-16 pt body
  // text, the range low-vision guidelines recommend for printed documents.
  const L = data.large_print ? 1.45 : 1;

  const title = data.clinic_name || "Dental Practice";
  const subtitleParts = [data.doctor_specialty, data.doctor_license ? `License ${data.doctor_license}` : null].filter(Boolean);
  const contactParts = [data.clinic_address, data.clinic_phone].filter(Boolean);

  const logo = data.clinic_logo ? <LetterheadLogo src={data.clinic_logo} heightMm={12} /> : null;

  const headerInner = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: "5mm" }}>
        {logo}
        <div>
          <div style={t.doctorName}>{doctorLabel}</div>
        {subtitleParts.length > 0 && (
          <div style={{ fontSize: "9pt", marginTop: 2, color: t.headerMuted, ...(t.doctorName.fontFamily ? { fontFamily: t.doctorName.fontFamily as string } : {}) }}>
            {subtitleParts.join(" · ")}
          </div>
        )}
        </div>
      </div>
      <div style={{ textAlign: "right", ...t.clinicTitle, lineHeight: 1.35 }}>
        {title}
        {contactParts.map((part, i) => (
          <div key={i} style={t.clinicDetail}>
            {part}
          </div>
        ))}
      </div>
    </>
  );

  const centeredHeaderInner = (
    <div style={{ textAlign: "center" }}>
      {logo && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "3mm" }}>
          {/* Centered layouts sit the logo above the name, crest-style. */}
          <span style={{ display: "inline-flex" }}>{logo}</span>
        </div>
      )}
      <div style={{ ...t.clinicTitle, marginBottom: 2 }}>{title}</div>
      {contactParts.length > 0 && (
        <div style={{ ...t.clinicDetail, textAlign: "center" }}>
          {contactParts.join(" · ")}
        </div>
      )}
      <div style={{ ...t.doctorName, marginTop: "3mm" }}>{doctorLabel}</div>
      {subtitleParts.length > 0 && (
        <div style={{ fontSize: "9pt", marginTop: 2, color: t.headerMuted, fontStyle: t.centeredHeader && data.template === "elegant" ? "italic" : undefined }}>
          {subtitleParts.join(" · ")}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ ...BASE_PAGE, ...t.page }} data-template={data.template}>
      {data.template === "watermark" && <Watermark />}

      {/* Letterhead */}
      <div
        style={{
          background: t.headerBg,
          color: t.headerColor,
          borderBottom: t.headerRule,
          padding: t.headerPad,
        }}
      >
        {t.centeredHeader ? (
          centeredHeaderInner
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            {headerInner}
          </div>
        )}
      </div>

      {/* Patient block */}
      <div
        style={{
          padding: t.bodyPad,
          paddingBottom: 0,
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          fontSize: `${9.5 * L}pt`,
          alignItems: "flex-start",
          color: t.bodyText,
        }}
      >
        <div>
          <div>
            <span style={{ color: t.mutedText }}>Patient: </span>
            <strong>{data.patient_name}</strong>
          </div>
          {data.patient_age && (
            <div>
              <span style={{ color: t.mutedText }}>Age: </span>
              {data.patient_age}
            </div>
          )}
          {data.patient_medical_alerts && (
            <div style={{ marginTop: 2 }}>
              <span style={{ color: t.mutedText }}>Alerts: </span>
              <span style={{ color: "#b45309", fontWeight: 600 }}>{data.patient_medical_alerts}</span>
            </div>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <div>
            <span style={{ color: t.mutedText }}>Date: </span>
            {formatDate(data.issued_date)}
          </div>
          {data.practitioner_name && data.practitioner_name !== data.doctor_name && (
            <div>
              <span style={{ color: t.mutedText }}>By: </span>
              {data.practitioner_name}
            </div>
          )}
        </div>
      </div>

      {/* Rx + medications */}
      <div style={{ padding: t.bodyPad, paddingTop: 2, flex: 1, color: t.bodyText }}>
        {(data.diagnosis || data.tooth || data.plan_treatment_name) && (
          <div
            style={{
              fontSize: `${9.5 * L}pt`,
              marginBottom: 8 * L,
              display: "flex",
              flexWrap: "wrap",
              alignItems: "baseline",
              gap: `${2 * L}mm`,
              rowGap: 2,
            }}
          >
            {data.diagnosis && (
              <span>
                <span style={{ color: t.mutedText }}>Diagnosis: </span>
                {data.diagnosis}
              </span>
            )}
            {data.tooth && (
              <span style={{ fontWeight: 700, color: t.accent, whiteSpace: "nowrap" }}>Tooth {data.tooth}</span>
            )}
            {data.plan_treatment_name && (
              <span style={{ color: t.mutedText }}>For: {data.plan_treatment_name}</span>
            )}
          </div>
        )}

        {data.images && data.images.some((i) => i.src) && (
          <div style={{ display: "flex", alignItems: "center", gap: `${3 * L}mm`, marginBottom: `${4 * L}mm`, flexWrap: "wrap" }}>
            <span style={{ color: t.mutedText, fontSize: `${8 * L}pt`, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginRight: "2mm" }}>
              X-ray
            </span>
            {data.images
              .filter((i) => i.src)
              .map((i) => (
                <img
                  key={i.id}
                  src={i.src!}
                  alt={i.label || "X-ray"}
                  title={i.label || "X-ray"}
                  style={{
                    height: `${20 * L}mm`,
                    objectFit: "contain",
                    border: "1px solid #cbd5e1",
                    borderRadius: "1mm",
                    background: "#ffffff",
                    marginRight: `${2 * L}mm`,
                  }}
                />
              ))}
          </div>
        )}

        <div style={t.rxStyle}>{data.template === "bold" ? "Rx" : "℞"}</div>

        {data.items.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: `${9.5 * L}pt` }}>No medications.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: `${10.5 * L}pt`, lineHeight: L > 1 ? 1.5 : undefined }}>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={i} style={{ borderBottom: t.medRowRule === "none" ? undefined : t.medRowRule }}>
                  <td style={{ width: "7mm", verticalAlign: "top", color: t.accent, fontWeight: 700, padding: `${2.5 * L}mm 0` }}>
                    {i + 1}.
                  </td>
                  <td style={{ verticalAlign: "top", padding: `${2.5 * L}mm 0` }}>
                    <div style={{ fontWeight: 700 }}>
                      {item.drug_name}
                      {item.generic_name ? <span style={{ fontWeight: 400, fontStyle: "italic", color: "#6b7280" }}> ({item.generic_name})</span> : null}
                      {item.dosage ? <span style={{ fontWeight: 400 }}> {item.dosage}</span> : null}
                    </div>
                    <div style={{ fontSize: `${9.5 * L}pt`, color: "#334155", marginTop: 1 }}>
                      {[
                        item.schedule ? DOSE_SCHEDULE_LABELS[item.schedule as keyof typeof DOSE_SCHEDULE_LABELS] : null,
                        item.frequency,
                        item.meal_relation ? MEAL_RELATION_LABELS[item.meal_relation as keyof typeof MEAL_RELATION_LABELS] : null,
                        item.duration ? `for ${item.duration}` : null,
                        item.instructions,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {data.advice && (
          <div style={{ marginTop: `${6 * L}mm`, fontSize: `${9.5 * L}pt`, lineHeight: L > 1 ? 1.5 : undefined }}>
            <div
              style={{
                fontWeight: 700,
                color: t.accent,
                textTransform: "uppercase",
                fontSize: `${8 * L}pt`,
                letterSpacing: "0.06em",
                marginBottom: 1,
                ...t.adviceLabel,
              }}
            >
              Advice
            </div>
            <div style={{ whiteSpace: "pre-line" }}>{data.advice}</div>
          </div>
        )}
      </div>

      {/* Signature + footer */}
      <div style={{ padding: t.bodyPad, paddingTop: 0 }}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10mm" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ borderTop: t.signatureRule, width: "48mm", paddingTop: 2, fontSize: "9pt", color: t.bodyText }}>
              {doctorLabel}
              {data.doctor_qualifications ? <span style={{ color: t.mutedText }}> · {data.doctor_qualifications}</span> : null}
              {data.doctor_license ? <span style={{ color: t.mutedText }}> · License {data.doctor_license}</span> : null}
            </div>
          </div>
        </div>
        {(data.follow_up || data.follow_up_date) && (
          <div style={{ marginTop: `${6 * L}mm`, fontSize: `${9.5 * L}pt`, color: t.bodyText }}>
            <span style={{ color: t.mutedText }}>Follow-up: </span>
            {data.follow_up_date ? <>{data.follow_up} {data.follow_up_date ? `· ${formatDate(data.follow_up_date)}` : ""}</> : data.follow_up}
          </div>
        )}
        {data.payment_qr && (
          <div style={{ marginTop: "3mm", display: "flex", justifyContent: "flex-end", gap: "2mm", alignItems: "center" }}>
            <img
              src={data.payment_qr}
              alt={data.payment_qr_label || "Payment QR"}
              style={{ width: `${20 * L}mm`, height: `${20 * L}mm`, objectFit: "contain", border: "1px solid #d1d5db" }}
            />
            {data.payment_qr_label && (
              <div style={{ fontSize: `${7.5 * L}pt`, color: t.mutedText, lineHeight: 1.3 }}>{data.payment_qr_label}</div>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          marginTop: "auto",
          borderTop: t.footerRule,
          padding: t.footerRule === "none" ? "4mm 14mm" : "3mm 14mm",
          fontSize: "7.5pt",
          color: t.footerMuted,
          textAlign: "center",
        }}
      >
        {title}
        {contactParts.length > 0 ? ` — ${contactParts.join(" · ")}` : ""}
      </div>
    </div>
  );
}
