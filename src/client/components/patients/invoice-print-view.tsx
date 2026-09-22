import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import type { Invoice, InvoiceItem, InvoicePayment } from "@/types";
import { Button } from "@/components/ui/button";
import { InvoiceSheet, isInvoiceStyle, type InvoiceSheetData } from "./invoice-sheet";

/**
 * Printable A4 invoice / receipt. Reuses the print-iframe technique from the
 * prescription view; the sheet itself (InvoiceSheet) is styleable from
 * Settings → Billing — template, accent color, terms and footer note — and
 * this view simply renders whatever the practice configured.
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
  const [sheet, setSheet] = useState<Omit<InvoiceSheetData, "invoice_id" | "issued_at" | "status" | "patient_name" | "items" | "total" | "amount_paid" | "balance" | "payments"> | null>(null);
  const [loading, setLoading] = useState(true);
  const printHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [res, settings] = await Promise.all([
          api<{
            invoice: Invoice & { patient_first_name: string | null; patient_last_name: string | null };
            items: InvoiceItem[];
            payments: InvoicePayment[];
          }>("GET", `/api/invoices/${invoiceId}`),
          api<{ settings: Record<string, string> }>("GET", "/api/settings").catch(() => ({ settings: {} as Record<string, string> })),
        ]);
        if (cancelled) return;
        setData(res);
        const s = settings.settings ?? {};
        setSheet({
          style: isInvoiceStyle(s.invoice_style) ? s.invoice_style : "classic",
          accent: /^#[0-9a-fA-F]{6}$/.test(s.invoice_accent ?? "") ? s.invoice_accent : "#0e7490",
          payment_terms: s.invoice_payment_terms ?? "",
          footer_note: s.invoice_footer_note ?? "",
          show_payments: (s.invoice_show_payments ?? "1") !== "0",
          clinic_name: s.clinic_name ?? "",
          clinic_address: s.clinic_address ?? "",
          clinic_phone: s.doctor_phone ?? "",
          clinic_logo: s.clinic_logo ?? "",
          doctor_name: s.doctor_name ?? "",
          doctor_specialty: s.doctor_specialty ?? "",
          doctor_license: s.doctor_license ?? "",
        });
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
  if (!data || !sheet) {
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

  const sheetData: InvoiceSheetData = {
    ...sheet,
    invoice_id: invoice.id,
    issued_at: invoice.issued_at,
    status: invoice.status,
    patient_name: patientName,
    items: items.map((it) => ({ description: it.description, quantity: it.quantity, unit_price: it.unit_price })),
    total: invoice.total,
    amount_paid: invoice.amount_paid,
    balance: invoice.total - invoice.amount_paid,
    payments: payments.map((p) => ({ id: p.id, paid_at: p.paid_at, method: p.method, note: p.note, amount: p.amount })),
  };

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
            <InvoiceSheet data={sheetData} />
          </div>
        </div>
      </div>
    </div>
  );
}
