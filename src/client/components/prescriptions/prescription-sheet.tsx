import type { PrescriptionTemplate } from "@/types";

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

export interface PrescriptionSheetData {
  clinic_name?: string | null;
  clinic_address?: string | null;
  clinic_phone?: string | null;
  doctor_name: string;
  doctor_specialty?: string | null;
  doctor_license?: string | null;
  patient_name: string;
  patient_age?: string | null;
  patient_medical_alerts?: string | null;
  practitioner_name?: string | null;
  issued_date: string;
  template: PrescriptionTemplate;
  diagnosis?: string | null;
  advice?: string | null;
  follow_up?: string | null;
  items: { drug_name: string; dosage?: string | null; frequency?: string | null; duration?: string | null; instructions?: string | null }[];
}

/** All templates, in gallery order. */
export const PRESCRIPTION_TEMPLATES: { id: PrescriptionTemplate; label: string; blurb: string }[] = [
  { id: "classic",    label: "Classic",    blurb: "Double-rule letterhead, formal" },
  { id: "modern",     label: "Modern",     blurb: "Full-color gradient header" },
  { id: "compact",    label: "Compact",    blurb: "Minimal header, ruled rows" },
  { id: "elegant",    label: "Elegant",    blurb: "Serif typography, centered crest" },
  { id: "minimal",    label: "Minimal",    blurb: "Whitespace, hairline rules" },
  { id: "bold",       label: "Bold",       blurb: "High-contrast blocks, dark header" },
  { id: "watermark",  label: "Watermark",  blurb: "Giant tooth behind the content" },
];

export function isPrescriptionTemplate(v: unknown): v is PrescriptionTemplate {
  return PRESCRIPTION_TEMPLATES.some((t) => t.id === v);
}

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

const TEMPLATES: Record<PrescriptionTemplate, TemplateStyle> = {
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
};

/** Decorative background layer (watermark template only). */
function Watermark() {
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
      <path d="M12 2C8.5 2 7 4.5 7 8c0 2.2.4 3.4.4 5.2 0 1.9-.9 4.6-.9 6.3 0 1.4.8 2.5 2 2.5 1.6 0 2-2.3 2.6-4.6.3-1.2.5-1.9.9-1.9s.6.7.9 1.9c.6 2.3 1 4.6 2.6 4.6 1.2 0 2-1.1 2-2.5 0-1.7-.9-4.4-.9-6.3C16.6 11.4 17 10.2 17 8c0-3.5-1.5-6-5-6Z" />
    </svg>
  );
}

/** One A4 prescription sheet. Pure presentational — no fetching, no hooks. */
export function PrescriptionSheet({ data }: { data: PrescriptionSheetData }) {
  const t = TEMPLATES[data.template] ?? TEMPLATES.classic;
  const doctorLabel = data.doctor_name.startsWith("Dr") ? data.doctor_name : `Dr. ${data.doctor_name}`;

  const title = data.clinic_name || "Dental Practice";
  const subtitleParts = [data.doctor_specialty, data.doctor_license ? `License ${data.doctor_license}` : null].filter(Boolean);
  const contactParts = [data.clinic_address, data.clinic_phone].filter(Boolean);

  const headerInner = (
    <>
      <div>
        <div style={t.doctorName}>{doctorLabel}</div>
        {subtitleParts.length > 0 && (
          <div style={{ fontSize: "9pt", marginTop: 2, color: t.headerMuted, ...(t.doctorName.fontFamily ? { fontFamily: t.doctorName.fontFamily as string } : {}) }}>
            {subtitleParts.join(" · ")}
          </div>
        )}
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
          fontSize: "9.5pt",
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
        {data.diagnosis && (
          <div style={{ fontSize: "9.5pt", marginBottom: 8 }}>
            <span style={{ color: t.mutedText }}>Diagnosis: </span>
            {data.diagnosis}
          </div>
        )}

        <div style={t.rxStyle}>{data.template === "bold" ? "Rx" : "℞"}</div>

        {data.items.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: "9.5pt" }}>No medications.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10.5pt" }}>
            <tbody>
              {data.items.map((item, i) => (
                <tr key={i} style={{ borderBottom: t.medRowRule === "none" ? undefined : t.medRowRule }}>
                  <td style={{ width: "7mm", verticalAlign: "top", color: t.accent, fontWeight: 700, padding: "2.5mm 0" }}>
                    {i + 1}.
                  </td>
                  <td style={{ verticalAlign: "top", padding: "2.5mm 0" }}>
                    <div style={{ fontWeight: 700 }}>
                      {item.drug_name}
                      {item.dosage ? <span style={{ fontWeight: 400 }}> {item.dosage}</span> : null}
                    </div>
                    <div style={{ fontSize: "9.5pt", color: "#334155", marginTop: 1 }}>
                      {[
                        item.frequency,
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
          <div style={{ marginTop: "6mm", fontSize: "9.5pt" }}>
            <div
              style={{
                fontWeight: 700,
                color: t.accent,
                textTransform: "uppercase",
                fontSize: "8pt",
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
              {data.doctor_license ? <span style={{ color: t.mutedText }}> · {data.doctor_license}</span> : null}
            </div>
          </div>
        </div>
        {data.follow_up && (
          <div style={{ marginTop: "6mm", fontSize: "9.5pt", color: t.bodyText }}>
            <span style={{ color: t.mutedText }}>Follow-up: </span>
            {data.follow_up}
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
