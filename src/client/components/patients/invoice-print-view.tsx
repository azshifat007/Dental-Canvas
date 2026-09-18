import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import type { Invoice, InvoiceItem, InvoicePayment } from "@/types";
import { formatDate, formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * Printable A4 invoice / receipt. Reuses the print-iframe technique from the
 * prescription view; the sheet itself is bespoke (itemized lines, totals,
 * payment history) but shares the prescription letterhead conventions so the
 * practice's paperwork looks consistent.
 */
export function InvoicePrintView({
  invoiceId,
  navigate,
}: {
  invoiceId: number;
  navigate: (to: string) => void;
}) {
  const app = useApp();
  const [data, setData] = useState<{
    invoice: Invoice & { patient_first_name: string | null; patient_last_name: string | null };
    items: InvoiceItem[];
    payments: InvoicePayment[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const printHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{
          invoice: Invoice & { patient_first_name: string | null; patient_last_name: string | null };
          items: InvoiceItem[];
          payments: InvoicePayment[];
        }>("GET", `/api/invoices/${invoiceId}`);
        if (!cancelled) setData(res);
      } catch (err) {
        if (!cancelled) app.setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  const print = () => {
    const host = printHostRef.current;
    if (!host) return;
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice</title>
      <style>@page { size: A4; margin: 0; } html, body { margin: 0; padding: 0; background: #fff; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }</style>
      </head><body>${host.innerHTML}</body></html>`);
    doc.close();
    frame.addEventListener("load", () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => frame.remove(), 500);
    });
  };

  if (loading) return <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>;
  if (!data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p>Invoice not found.</p>
        <Button variant="outline" onClick={() => history.back()}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
    );
  }

  const { invoice, items, payments } = data;
  const patientName = `${invoice.patient_first_name ?? ""} ${invoice.patient_last_name ?? ""}`.trim() || "Patient";
  const balance = invoice.total - invoice.amount_paid;
  const money = (n: number) => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
  const profile = app.profile;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-muted/60 dark:bg-background">
      <div className="flex items-center gap-2 border-b bg-card px-4 py-3">
        <Button variant="outline" size="sm" onClick={() => navigate(`/patients/${invoice.patient_id}`)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <h1 className="text-base font-semibold tracking-tight">
          Invoice #{invoice.id} · {patientName}
        </h1>
        <div className="ml-auto">
          <Button size="sm" onClick={print}>
            <Printer className="h-4 w-4" /> Print
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto w-fit origin-top shadow-xl" style={{ transform: "scale(0.75)" }}>
          <div ref={printHostRef}>
            {/* The A4 sheet — inline styles so the print iframe needs no CSS. */}
            <div
              style={{
                width: "210mm",
                minHeight: "297mm",
                margin: "0 auto",
                background: "#ffffff",
                color: "#1a2430",
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                fontFamily: 'Inter, "Segoe UI", system-ui, sans-serif',
                padding: "14mm 16mm",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "3px double #0e7490", paddingBottom: "6mm" }}>
                <div>
                  <div style={{ fontSize: "18pt", fontWeight: 700 }}>
                    {profile.doctor_name ? (profile.doctor_name.startsWith("Dr") ? profile.doctor_name : `Dr. ${profile.doctor_name}`) : "Dental Practice"}
                  </div>
                  <div style={{ fontSize: "9pt", color: "#64748b", marginTop: 2 }}>
                    {[profile.doctor_specialty, profile.doctor_license ? `License ${profile.doctor_license}` : null].filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ fontSize: "8pt", color: "#64748b", whiteSpace: "pre-line" }}>
                    {[profile.clinic_name, profile.clinic_address, profile.doctor_phone].filter(Boolean).join("\n")}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "22pt", fontWeight: 800, color: "#0e7490", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Invoice
                  </div>
                  <div style={{ fontSize: "10pt" }}>
                    <strong>#{String(invoice.id).padStart(5, "0")}</strong>
                  </div>
                  <div style={{ fontSize: "9pt", color: "#64748b" }}>Issued {formatDate(invoice.issued_at)}</div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", padding: "8mm 0 4mm", fontSize: "10pt" }}>
                <div>
                  <div style={{ fontSize: "8pt", textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b" }}>Billed to</div>
                  <div style={{ fontWeight: 700 }}>{patientName}</div>
                </div>
                <div style={{ textAlign: "right", fontSize: "9pt", color: "#64748b" }}>
                  Status: <strong style={{ color: invoice.status === "paid" ? "#047857" : "#b45309" }}>{invoice.status.toUpperCase()}</strong>
                </div>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "10pt" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid #0e7490", textAlign: "left" }}>
                    <th style={{ padding: "2mm 0", fontSize: "8pt", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>Description</th>
                    <th style={{ padding: "2mm 0", textAlign: "right", fontSize: "8pt", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>Qty</th>
                    <th style={{ padding: "2mm 0", textAlign: "right", fontSize: "8pt", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>Unit</th>
                    <th style={{ padding: "2mm 0", textAlign: "right", fontSize: "8pt", textTransform: "uppercase", letterSpacing: "0.06em", color: "#64748b" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: "4mm 0", color: "#94a3b8" }}>No line items.</td>
                    </tr>
                  ) : (
                    items.map((it, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={{ padding: "2.5mm 0" }}>{it.description}</td>
                        <td style={{ padding: "2.5mm 0", textAlign: "right" }}>{it.quantity}</td>
                        <td style={{ padding: "2.5mm 0", textAlign: "right" }}>{money(it.unit_price)}</td>
                        <td style={{ padding: "2.5mm 0", textAlign: "right", fontWeight: 600 }}>{money(it.quantity * it.unit_price)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "6mm" }}>
                <table style={{ fontSize: "10pt", minWidth: "70mm" }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: "1.5mm 0", color: "#64748b" }}>Total</td>
                      <td style={{ padding: "1.5mm 0", textAlign: "right", fontWeight: 700 }}>{money(invoice.total)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: "1.5mm 0", color: "#64748b" }}>Paid</td>
                      <td style={{ padding: "1.5mm 0", textAlign: "right", color: "#047857" }}>{money(invoice.amount_paid)}</td>
                    </tr>
                    <tr style={{ borderTop: "2px solid #0e7490" }}>
                      <td style={{ padding: "2mm 0", fontWeight: 800 }}>Balance due</td>
                      <td style={{ padding: "2mm 0", textAlign: "right", fontWeight: 800, color: balance > 0 ? "#be123c" : "#047857" }}>{money(balance)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {payments.length > 0 && (
                <div style={{ marginTop: "8mm", fontSize: "9pt" }}>
                  <div style={{ fontSize: "8pt", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#64748b", marginBottom: "1mm" }}>
                    Payment history
                  </div>
                  {payments.map((p) => (
                    <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "1mm 0", color: "#334155" }}>
                      <span>
                        {formatDate(p.paid_at)} {formatTime(p.paid_at)} — {p.method}
                        {p.note ? ` (${p.note})` : ""}
                      </span>
                      <span style={{ fontWeight: 600 }}>{money(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: "auto", borderTop: "1px solid #e2e8f0", paddingTop: "3mm", fontSize: "7.5pt", color: "#94a3b8", textAlign: "center" }}>
                Thank you for your visit. {profile.clinic_name || ""} {profile.doctor_phone ? `· ${profile.doctor_phone}` : ""}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
