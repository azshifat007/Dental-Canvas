import type { CSSProperties, ReactElement } from "react";

/**
 * The printable A4 invoice document — an inline-styled sheet rendered in one
 * of several styles, so the practice can customize how its bills look.
 *
 * Styling is plain React inline styles: the print window clones this DOM
 * directly (the app stylesheet isn't attached there), and everything —
 * accent color, footer note, payment terms, visibility of the payment
 * history — is data-driven from Settings → Billing, so what you configure is
 * exactly what prints.
 */

export type InvoiceStyle = "classic" | "modern" | "compact" | "elegant";

export const INVOICE_STYLES: { id: InvoiceStyle; label: string; blurb: string }[] = [
  { id: "classic", label: "Classic", blurb: "Double-rule header, teal accents — the current look" },
  { id: "modern", label: "Modern", blurb: "Bold color banner across the top" },
  { id: "compact", label: "Compact", blurb: "Minimal header, fits more line items per page" },
  { id: "elegant", label: "Elegant", blurb: "Serif typography, centered crest letterhead" },
];

export function isInvoiceStyle(v: unknown): v is InvoiceStyle {
  return INVOICE_STYLES.some((s) => s.id === v);
}

export interface InvoiceSheetData {
  invoice_id: number;
  issued_at: string;
  status: string;
  patient_name: string;
  items: { description: string; quantity: number; unit_price: number }[];
  total: number;
  amount_paid: number;
  balance: number;
  payments: { id: number; paid_at: string; method: string; note?: string | null; amount: number }[];
  // Practice letterhead
  clinic_name?: string | null;
  clinic_address?: string | null;
  clinic_phone?: string | null;
  clinic_logo?: string | null;
  doctor_name: string;
  doctor_specialty?: string | null;
  doctor_license?: string | null;
  // Customization (Settings → Billing)
  style: InvoiceStyle;
  /** Hex color (e.g. #0e7490) used for the header band, rules and totals. */
  accent: string;
  /** Line printed under "Balance due" — e.g. "Payment due within 14 days". */
  payment_terms?: string | null;
  /** Closing note printed in the footer — e.g. a thank-you or bank details. */
  footer_note?: string | null;
  /** Hide the per-payment history block (e.g. for hand-issued bills). */
  show_payments: boolean;
}

const BASE_PAGE: CSSProperties = {
  width: "210mm",
  minHeight: "297mm",
  margin: "0 auto",
  background: "#ffffff",
  color: "#1a2430",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
};

/** Lighten/darken a hex color for hover-free two-tone accents. */
function shade(hex: string, amount: number): string {
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return hex;
  const num = parseInt(full, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + amount);
  const g = clamp(((num >> 8) & 0xff) + amount);
  const b = clamp((num & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function doctorLabel(name: string): string {
  return name ? (name.startsWith("Dr") ? name : `Dr. ${name}`) : "Dental Practice";
}

function formatDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function InvoiceSheet({ data }: { data: InvoiceSheetData }) {
  const money = (n: number) =>
    n.toLocaleString(undefined, { style: "currency", currency: "USD" });

  const accent = data.accent || "#0e7490";
  const accentDark = shade(accent, -30);
  const accentSoft = shade(accent, 150);
  const muted = "#64748b";
  const hairline = "#e2e8f0";

  const practice = data.clinic_name || "Dental Practice";
  const contactLines = [data.clinic_address, data.clinic_phone].filter(Boolean);
  const subtitle = [data.doctor_specialty, data.doctor_license ? `License ${data.doctor_license}` : null]
    .filter(Boolean)
    .join(" · ");
  const statusColor = data.status === "paid" ? "#047857" : data.status === "void" ? "#b91c1c" : "#b45309";

  const paidRow = (
    <tr>
      <td style={{ padding: "1.5mm 0", color: muted }}>Paid</td>
      <td style={{ padding: "1.5mm 0", textAlign: "right", color: "#047857" }}>{money(data.amount_paid)}</td>
    </tr>
  );

  const balanceRow = (borderTop: CSSProperties) => (
    <tr style={borderTop}>
      <td style={{ padding: "2mm 0", fontWeight: 800 }}>Balance due</td>
      <td
        style={{
          padding: "2mm 0",
          textAlign: "right",
          fontWeight: 800,
          color: data.balance > 0 ? "#be123c" : "#047857",
        }}
      >
        {money(data.balance)}
      </td>
    </tr>
  );

  const itemsTable = (headRule: CSSProperties, rowRule: CSSProperties, compact = false): ReactElement => (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: compact ? "9.5pt" : "10pt" }}>
      <thead>
        <tr style={headRule}>
          {(["Description", "Qty", "Unit", "Amount"] as const).map((h, i) => (
            <th
              key={h}
              style={{
                padding: "2mm 0",
                textAlign: i === 0 ? "left" : "right",
                fontSize: "8pt",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: muted,
                fontWeight: 600,
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.items.length === 0 ? (
          <tr>
            <td colSpan={4} style={{ padding: "4mm 0", color: "#94a3b8" }}>
              No line items.
            </td>
          </tr>
        ) : (
          data.items.map((it, i) => (
            <tr key={i} style={rowRule}>
              <td style={{ padding: compact ? "1.8mm 0" : "2.5mm 0" }}>{it.description}</td>
              <td style={{ padding: compact ? "1.8mm 0" : "2.5mm 0", textAlign: "right" }}>{it.quantity}</td>
              <td style={{ padding: compact ? "1.8mm 0" : "2.5mm 0", textAlign: "right" }}>{money(it.unit_price)}</td>
              <td style={{ padding: compact ? "1.8mm 0" : "2.5mm 0", textAlign: "right", fontWeight: 600 }}>
                {money(it.quantity * it.unit_price)}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  const paymentsBlock = data.show_payments && data.payments.length > 0 && (
    <div style={{ marginTop: "8mm", fontSize: "9pt" }}>
      <div
        style={{
          fontSize: "8pt",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: muted,
          marginBottom: "1mm",
        }}
      >
        Payment history
      </div>
      {data.payments.map((p) => (
        <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "1mm 0", color: "#334155" }}>
          <span>
            {formatDate(p.paid_at)} {new Date(p.paid_at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} — {p.method}
            {p.note ? ` (${p.note})` : ""}
          </span>
          <span style={{ fontWeight: 600 }}>{money(p.amount)}</span>
        </div>
      ))}
    </div>
  );

  const termsBlock = data.payment_terms?.trim() ? (
    <div style={{ marginTop: "4mm", fontSize: "8.5pt", color: muted, fontStyle: "italic" }}>{data.payment_terms.trim()}</div>
  ) : null;

  const footerText = data.footer_note?.trim() || `Thank you for your visit. ${data.clinic_name || ""} ${data.clinic_phone ? `· ${data.clinic_phone}` : ""}`.trim();

  // ── Classic — double-rule, side-by-side letterhead (the original look) ──
  if (data.style === "classic") {
    return (
      <div style={{ ...BASE_PAGE, padding: "14mm 16mm" }}>
        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: `3px double ${accent}`, paddingBottom: "6mm" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "5mm" }}>
            {data.clinic_logo ? <img src={data.clinic_logo} alt="" style={{ height: "12mm", maxWidth: "55mm", objectFit: "contain", display: "block" }} /> : null}
            <div>
              <div style={{ fontSize: "18pt", fontWeight: 700 }}>{doctorLabel(data.doctor_name)}</div>
              {subtitle && <div style={{ fontSize: "9pt", color: muted, marginTop: 2 }}>{subtitle}</div>}
              <div style={{ fontSize: "8pt", color: muted, whiteSpace: "pre-line" }}>
                {[data.clinic_name, ...contactLines].filter(Boolean).join("\n")}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "22pt", fontWeight: 800, color: accent, textTransform: "uppercase", letterSpacing: "0.05em" }}>Invoice</div>
            <div style={{ fontSize: "10pt" }}>
              <strong>#{String(data.invoice_id).padStart(5, "0")}</strong>
            </div>
            <div style={{ fontSize: "9pt", color: muted }}>Issued {formatDate(data.issued_at)}</div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", padding: "8mm 0 4mm", fontSize: "10pt" }}>
          <div>
            <div style={{ fontSize: "8pt", textTransform: "uppercase", letterSpacing: "0.08em", color: muted }}>Billed to</div>
            <div style={{ fontWeight: 700 }}>{data.patient_name}</div>
          </div>
          <div style={{ textAlign: "right", fontSize: "9pt", color: muted }}>
            Status: <strong style={{ color: statusColor }}>{data.status.toUpperCase()}</strong>
          </div>
        </div>

        {itemsTable({ borderBottom: `2px solid ${accent}` }, { borderBottom: `1px solid ${hairline}` })}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6mm" }}>
          <table style={{ fontSize: "10pt", minWidth: "70mm" }}>
            <tbody>
              <tr>
                <td style={{ padding: "1.5mm 0", color: muted }}>Total</td>
                <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: 700 }}>{money(data.total)}</td>
              </tr>
              {paidRow}
              {balanceRow({ borderTop: `2px solid ${accent}` })}
            </tbody>
          </table>
        </div>
        {termsBlock}
        {paymentsBlock}

        <div style={{ marginTop: "auto", borderTop: `1px solid ${hairline}`, paddingTop: "3mm", fontSize: "7.5pt", color: "#94a3b8", textAlign: "center" }}>
          {footerText}
        </div>
      </div>
    );
  }

  // ── Modern — full-width accent banner across the top ──
  if (data.style === "modern") {
    return (
      <div style={BASE_PAGE}>
        <div style={{ background: accent, color: "#ffffff", padding: "12mm 16mm 10mm" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "5mm" }}>
              {data.clinic_logo ? (
                <div style={{ background: "#ffffff", borderRadius: "2mm", padding: "2mm", display: "flex" }}>
                  <img src={data.clinic_logo} alt="" style={{ height: "11mm", maxWidth: "50mm", objectFit: "contain", display: "block" }} />
                </div>
              ) : null}
              <div>
                <div style={{ fontSize: "17pt", fontWeight: 800 }}>{doctorLabel(data.doctor_name)}</div>
                {subtitle && <div style={{ fontSize: "9pt", opacity: 0.85, marginTop: 2 }}>{subtitle}</div>}
                <div style={{ fontSize: "8pt", opacity: 0.85, whiteSpace: "pre-line" }}>
                  {[data.clinic_name, ...contactLines].filter(Boolean).join("\n")}
                </div>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "24pt", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}>Invoice</div>
              <div style={{ fontSize: "11pt", fontWeight: 600 }}>#{String(data.invoice_id).padStart(5, "0")}</div>
            </div>
          </div>
        </div>
        <div style={{ padding: "8mm 16mm 14mm", display: "flex", flexDirection: "column", flex: 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "2mm" }}>
            <div>
              <div style={{ fontSize: "8pt", textTransform: "uppercase", letterSpacing: "0.08em", color: muted }}>Billed to</div>
              <div style={{ fontWeight: 700, fontSize: "11pt" }}>{data.patient_name}</div>
            </div>
            <div style={{ fontSize: "9pt", color: muted }}>
              Issued {formatDate(data.issued_at)} ·{" "}
              <strong style={{ color: statusColor }}>{data.status.toUpperCase()}</strong>
            </div>
          </div>

          {itemsTable({ borderBottom: `2px solid ${accent}` }, { borderBottom: `1px solid ${hairline}` })}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6mm" }}>
            <table style={{ fontSize: "10pt", minWidth: "70mm" }}>
              <tbody>
                <tr>
                  <td style={{ padding: "1.5mm 0", color: muted }}>Total</td>
                  <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: 700 }}>{money(data.total)}</td>
                </tr>
                {paidRow}
                {balanceRow({ borderTop: `2px solid ${accent}` })}
              </tbody>
            </table>
          </div>
          {termsBlock}
          {paymentsBlock}

          <div style={{ marginTop: "auto", paddingTop: "3mm", fontSize: "7.5pt", color: "#94a3b8", textAlign: "center" }}>
            {footerText}
          </div>
        </div>
      </div>
    );
  }

  // ── Compact — minimal header, tighter rows, small footnote title ──
  if (data.style === "compact") {
    return (
      <div style={{ ...BASE_PAGE, padding: "10mm 12mm" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: "4mm", borderBottom: `2px solid ${accent}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "3mm" }}>
            {data.clinic_logo ? <img src={data.clinic_logo} alt="" style={{ height: "8mm", maxWidth: "40mm", objectFit: "contain", display: "block" }} /> : null}
            <div style={{ fontSize: "11pt", fontWeight: 700 }}>
              {practice} <span style={{ fontWeight: 400, color: muted }}>· {doctorLabel(data.doctor_name)}</span>
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: "8pt", color: muted, lineHeight: 1.5 }}>
            {[...contactLines, data.clinic_name && practice !== data.clinic_name ? data.clinic_name : null]
              .filter(Boolean)
              .slice(0, 3)
              .map((l, i) => (
                <div key={i}>{l}</div>
              ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5mm 0 4mm" }}>
          <div style={{ fontSize: "14pt", fontWeight: 800 }}>
            Invoice <span style={{ fontWeight: 400, color: muted, fontSize: "10pt" }}>#{String(data.invoice_id).padStart(5, "0")}</span>
          </div>
          <div style={{ fontSize: "9pt", color: muted }}>
            {formatDate(data.issued_at)} · <strong style={{ color: statusColor }}>{data.status.toUpperCase()}</strong> ·{" "}
            <strong style={{ color: "#1a2430" }}>{data.patient_name}</strong>
          </div>
        </div>

        {itemsTable({ borderBottom: `2px solid ${accent}` }, { borderBottom: `1px solid ${hairline}` }, true)}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4mm" }}>
          <table style={{ fontSize: "9.5pt", minWidth: "60mm" }}>
            <tbody>
              <tr>
                <td style={{ padding: "1.2mm 0", color: muted }}>Total</td>
                <td style={{ padding: "1.2mm 0", textAlign: "right", fontWeight: 700 }}>{money(data.total)}</td>
              </tr>
              {paidRow}
              {balanceRow({ borderTop: `2px solid ${accent}` })}
            </tbody>
          </table>
        </div>
        {termsBlock}
        {paymentsBlock}

        <div style={{ marginTop: "auto", paddingTop: "2.5mm", fontSize: "7pt", color: "#94a3b8", textAlign: "center" }}>
          {footerText}
        </div>
      </div>
    );
  }

  // ── Elegant — serif typography, centered crest letterhead ──
  return (
    <div style={{ ...BASE_PAGE, fontFamily: 'Georgia, "Times New Roman", serif', padding: "14mm 18mm" }}>
      <div style={{ textAlign: "center", borderBottom: `1px solid ${accent}`, paddingBottom: "6mm" }}>
        {data.clinic_logo ? (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "3mm" }}>
            <img src={data.clinic_logo} alt="" style={{ height: "13mm", maxWidth: "55mm", objectFit: "contain", display: "block" }} />
          </div>
        ) : null}
        <div style={{ fontSize: "20pt", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>{practice}</div>
        {contactLines.length > 0 && (
          <div style={{ fontSize: "9pt", color: muted, marginTop: "1.5mm" }}>{contactLines.join(" · ")}</div>
        )}
        <div style={{ fontSize: "10.5pt", marginTop: "2.5mm", color: accentDark }}>{doctorLabel(data.doctor_name)}</div>
        {subtitle && <div style={{ fontSize: "9pt", color: muted, marginTop: 1, fontStyle: "italic" }}>{subtitle}</div>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8mm 0 4mm" }}>
        <div style={{ fontSize: "16pt", letterSpacing: "0.14em", textTransform: "uppercase" }}>Invoice</div>
        <div style={{ fontSize: "9.5pt", color: muted }}>
          #{String(data.invoice_id).padStart(5, "0")} · {formatDate(data.issued_at)} ·{" "}
          <strong style={{ color: statusColor }}>{data.status.toUpperCase()}</strong>
        </div>
      </div>

      <div style={{ padding: "0 0 5mm", fontSize: "10pt" }}>
        <span style={{ fontSize: "8pt", textTransform: "uppercase", letterSpacing: "0.08em", color: muted, marginRight: "2mm" }}>Billed to</span>
        <span style={{ fontWeight: 700 }}>{data.patient_name}</span>
      </div>

      {itemsTable({ borderTop: `1px solid ${accent}`, borderBottom: `1px solid ${accent}` }, { borderBottom: `1px solid ${hairline}` })}

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6mm" }}>
        <table style={{ fontSize: "10pt", minWidth: "70mm" }}>
          <tbody>
            <tr>
              <td style={{ padding: "1.5mm 0", color: muted }}>Total</td>
              <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: 700 }}>{money(data.total)}</td>
            </tr>
            {paidRow}
            {balanceRow({ borderTop: `2px solid ${accent}` })}
          </tbody>
        </table>
      </div>
      {termsBlock}
      {paymentsBlock}

      <div style={{ marginTop: "auto", borderTop: `1px solid ${accentSoft}`, paddingTop: "3mm", fontSize: "8pt", color: "#94a3b8", textAlign: "center", fontStyle: "italic" }}>
        {footerText}
      </div>
    </div>
  );
}
