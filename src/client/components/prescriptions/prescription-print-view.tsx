import { useCallback, useEffect, useRef, useState } from "react";
import { ALargeSmall, ArrowLeft, Download, Eye, Printer, Share2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import type { Prescription, PrescriptionTemplate } from "@/types";
import { cn } from "@/lib/utils";
import { PrescriptionSheet, isPrescriptionTemplate } from "./prescription-sheet";
import { PrescriptionPreviewModal } from "./prescription-preview-modal";
import { TemplateDropdown } from "./template-picker";
import { printSheetHtml, downloadSheetPdf, shareSheetPdf } from "@/lib/print";
import { ageFromDob } from "@/lib/utils";

/**
 * In-app prescription print/share view: shows the A4 sheet scaled to the
 * viewport, with a toolbar for printing, PDF download, template switching and
 * PDF-file sharing (native share sheet where available).
 */

const TEMPLATE_LABELS: Record<PrescriptionTemplate, string> = {
  chamber: "Chamber",
  classic: "Classic",
  modern: "Modern",
  compact: "Compact",
  elegant: "Elegant",
  minimal: "Minimal",
  bold: "Bold",
  watermark: "Watermark",
};

export function PrescriptionPrintView({
  prescriptionId,
  navigate,
}: {
  prescriptionId: number;
  navigate: (to: string) => void;
}) {
  const app = useApp();
  const [rx, setRx] = useState<Prescription | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const printHostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{ prescription: Prescription }>("GET", `/api/prescriptions/${prescriptionId}`);
        if (!cancelled) setRx(res.prescription);
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
  }, [prescriptionId]);

  const sheetData = rx ? buildSheetData(rx, app.profile) : null;

  /** Print by cloning the sheet markup into a dedicated iframe (shared helper). */
  const printSheet = useCallback(() => {
    printSheetHtml(printHostRef.current, `Prescription ${rx?.id ?? ""}`);
  }, [rx?.id]);

  const [downloading, setDownloading] = useState(false);

  const downloadSheet = useCallback(async () => {
    if (!rx) return;
    setDownloading(true);
    try {
      await downloadSheetPdf(
        printHostRef.current,
        `prescription-${(rx.patient_last_name ?? "patient").toLowerCase().replace(/\s+/g, "-")}-${rx.issued_date}.pdf`,
      );
    } catch (err) {
      app.setError(`Could not generate the PDF: ${(err as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }, [rx, app]);

  if (loading) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading…</div>;
  }
  if (!rx || !sheetData) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p>Prescription not found.</p>
        <button
          onClick={() => navigate(`/patients/${rx?.patient_id ?? ""}`)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-muted/60 dark:bg-background">
      <div className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-3">
        <button
          onClick={() => navigate(`/patients/${rx.patient_id}`)}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <h1 className="text-base font-semibold tracking-tight">
          Prescription · {rx.patient_first_name} {rx.patient_last_name}
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPreviewOpen(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent"
            title="Full-size preview — exactly what prints"
          >
            <Eye className="h-4 w-4" /> Preview
          </button>
          <TemplateDropdown
            value={rx.template}
            onChange={async (t) => {
              try {
                const updated = await api<{ prescription: Prescription }>("PUT", `/api/prescriptions/${rx.id}`, { template: t });
                setRx(updated.prescription);
              } catch (err) {
                app.setError((err as Error).message);
              }
            }}
          />
          <button
            onClick={async () => {
              try {
                const updated = await api<{ prescription: Prescription }>("PUT", `/api/prescriptions/${rx.id}`, {
                  large_print: !rx.large_print,
                });
                setRx(updated.prescription);
              } catch (err) {
                app.setError((err as Error).message);
              }
            }}
            aria-pressed={Boolean(rx.large_print)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-sm hover:bg-accent",
              rx.large_print && "border-primary bg-primary/10 text-primary",
            )}
            title="Enlarged medication and advice text for visually impaired patients"
          >
            <ALargeSmall className="h-4 w-4" />
            Large print
          </button>
          <SharePdfButton rx={rx} printHostRef={printHostRef} />
          <button
            onClick={downloadSheet}
            disabled={downloading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent disabled:opacity-60"
          >
            <Download className="h-4 w-4" /> {downloading ? "Generating…" : "PDF"}
          </button>
          <button
            onClick={printSheet}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Printer className="h-4 w-4" /> Print
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto w-fit origin-top shadow-xl print:hidden" style={{ transform: "scale(0.75)" }}>
          <div ref={printHostRef}>
            <PrescriptionSheet data={sheetData} />
          </div>
        </div>
      </div>

      {sheetData && (
        <PrescriptionPreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          data={sheetData}
          title={`Prescription — ${sheetData.patient_name}`}
          onTemplateChange={async (t) => {
            // Persist template switches made inside the preview, same as the dropdown.
            try {
              const updated = await api<{ prescription: Prescription }>("PUT", `/api/prescriptions/${rx!.id}`, { template: t });
              setRx(updated.prescription);
            } catch (err) {
              app.setError((err as Error).message);
            }
          }}
          onLargePrintChange={async (on) => {
            try {
              const updated = await api<{ prescription: Prescription }>("PUT", `/api/prescriptions/${rx!.id}`, { large_print: on });
              setRx(updated.prescription);
            } catch (err) {
              app.setError((err as Error).message);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Share the prescription as a PDF *file* through the platform share sheet
 * (WhatsApp/SMS/email attachments, save to Files, …); falls back to a plain
 * download on browsers without Web Share file support.
 */
function SharePdfButton({
  rx,
  printHostRef,
}: {
  rx: Prescription;
  printHostRef: React.RefObject<HTMLDivElement | null>;
}) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"shared" | "downloaded" | null>(null);

  async function share() {
    setBusy(true);
    try {
      const filename = `prescription-${(rx.patient_last_name ?? "patient").toLowerCase().replace(/\s+/g, "-")}-${rx.issued_date}.pdf`;
      const result = await shareSheetPdf(printHostRef.current, filename, {
        title: `Prescription — ${rx.patient_first_name ?? ""} ${rx.patient_last_name ?? ""}`.trim(),
        text: `Prescription from ${rx.issued_date}`,
      });
      setDone(result);
      setTimeout(() => setDone(null), 2500);
    } catch (err) {
      // A user-cancelled share sheet must not look like an error.
      if ((err as Error)?.name !== "AbortError") {
        app.setError(`Could not share the PDF: ${(err as Error).message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={share}
      disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent disabled:opacity-60"
      title="Send the prescription as a PDF file — via WhatsApp, SMS, email or save to device"
    >
      <Share2 className="h-4 w-4" />
      {busy ? "Preparing…" : done === "downloaded" ? "Saved" : done === "shared" ? "Shared" : "Share PDF"}
    </button>
  );
}

/** Compose what the sheet needs from the prescription row + practice profile. */
export function buildSheetData(
  rx: Prescription,
  profile: {
    doctor_name: string;
    doctor_specialty: string;
    doctor_license: string;
    clinic_name: string;
    clinic_address: string;
    doctor_phone: string;
    clinic_logo?: string;
  },
) {
  const alerts = (rx.patient_medical_alerts ?? "").split(",").map((s) => s.trim()).filter(Boolean).join(", ");
  return {
    clinic_name: profile.clinic_name,
    clinic_address: profile.clinic_address,
    clinic_phone: profile.doctor_phone,
    clinic_logo: profile.clinic_logo ?? null,
    doctor_name: profile.doctor_name || "Doctor",
    doctor_specialty: profile.doctor_specialty,
    doctor_license: profile.doctor_license,
    patient_name: `${rx.patient_first_name ?? ""} ${rx.patient_last_name ?? ""}`.trim() || "Patient",
    patient_age: ageFromDob(rx.patient_date_of_birth ?? null),
    patient_medical_alerts: alerts || null,
    practitioner_name: rx.practitioner_name ?? null,
    issued_date: rx.issued_date,
    template: isPrescriptionTemplate(rx.template) ? rx.template : "chamber",
    large_print: Boolean(rx.large_print),
    tooth: rx.tooth,
    plan_treatment_name: rx.plan_treatment_name ?? null,
    diagnosis: rx.diagnosis,
    advice: rx.advice,
    follow_up: rx.follow_up,
    items: rx.items ?? [],
  };
}


