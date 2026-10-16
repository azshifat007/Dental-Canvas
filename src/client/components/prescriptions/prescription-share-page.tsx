import { useEffect, useState, useRef } from "react";
import { Printer, Download, MessageCircle, Mail, Share2, ArrowLeft } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import type { Prescription } from "@/types";
import { PrescriptionSheet, isPrescriptionTemplate } from "./prescription-sheet";
import { buildSheetData } from "./prescription-print-view";
import { printSheetHtml, downloadSheetPdf, shareSheetPdf } from "@/lib/print";
import { openExternalUrl } from "@/lib/open-external";
import { useMaterializedImages } from "@/lib/images";
import { Button } from "@/components/ui/button";

/**
 * Public, no-auth share page for a prescription: renders the A4 sheet (any
 * template, including two-column) in a standalone page so a patient can view /
 * print / download / share it without being inside the app.
 *
 * The whole PrescriptionSheet + template-picker graph is statically referenced
 * from this top-level route component, so the bundler keeps every template
 * body (two-column, chamber, watermark, …) in the production build.
 */

export function PrescriptionSharePage({
  token,
}: {
  token: string;
}) {
  const app = useApp();
  const [rx, setRx] = useState<Prescription | null>(null);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [shareDone, setShareDone] = useState<"shared" | "downloaded" | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Public share links carry the share token in the URL, so this page
        // reads through the no-auth endpoint rather than the authenticated one.
        const res = await api<{ prescription: Prescription }>(
          "GET",
          `/api/prescriptions/share/${token}`,
        );
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
  }, [token]);

  const sheetData = rx ? buildSheetData(rx, app.profile) : null;
  const materialized = useMaterializedImages(sheetData?.images ?? []);
  const displayData = sheetData
    ? { ...sheetData, images: materialized.images }
    : null;

  const printSheet = () => {
    printSheetHtml(hostRef.current, `Prescription ${rx?.id ?? ""}`);
  };

  const downloadPdf = async () => {
    if (!rx) return;
    try {
      await downloadSheetPdf(
        hostRef.current,
        `prescription-${(rx.patient_last_name ?? "patient")
          .toLowerCase()
          .replace(/\s+/g, "-")}-${rx.issued_date}.pdf`,
      );
    } catch (err) {
      app.setError(`Could not generate the PDF: ${(err as Error).message}`);
    }
  };

  const sharePdf = async () => {
    if (!rx) return;
    setSharing(true);
    try {
      const filename = `prescription-${(rx.patient_last_name ?? "patient")
        .toLowerCase()
        .replace(/\s+/g, "-")}-${rx.issued_date}.pdf`;
      const result = await shareSheetPdf(hostRef.current, filename, {
        title: `Prescription — ${rx.patient_first_name ?? ""} ${rx.patient_last_name ?? ""}`.trim(),
        text: `Prescription from ${rx.issued_date}`,
      });
      setShareDone(result);
      setTimeout(() => setShareDone(null), 2500);
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        app.setError(`Could not share the PDF: ${(err as Error).message}`);
      }
    } finally {
      setSharing(false);
    }
  };

  const shareWhatsApp = () => {
    if (!rx || !rx.patient_phone) return;
    const digits = rx.patient_phone.replace(/\D/g, "");
    const text = encodeURIComponent(
      `Hello ${rx.patient_first_name ?? ""}, here is your prescription from ${app.profile.clinic_name ?? app.profile.doctor_name ?? "the practice"} (${rx.issued_date}).`,
    );
    openExternalUrl(`https://wa.me/${digits}?text=${text}`);
    downloadPdf();
  };

  const openEmailClient = () => {
    if (!rx || !rx.patient_email) return;
    openExternalUrl(
      `mailto:${rx.patient_email}?subject=Your%20prescription&body=Please%20find%20your%20prescription%20attached.`,
    );
  };

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-6 text-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="mt-4 text-sm text-muted-foreground">Loading prescription…</p>
      </div>
    );
  }

  if (!rx) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-6 text-center">
        <h1 className="text-lg font-semibold">Prescription not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This prescription doesn't exist or has been removed.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-muted/40">
      <header className="flex flex-wrap items-center gap-2 border-b bg-card px-4 py-3">
        <Button variant="outline" size="icon" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-base font-semibold tracking-tight">
          Prescription · {rx.patient_first_name} {rx.patient_last_name}
        </h1>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {rx.patient_email && (
            <Button variant="outline" size="icon" onClick={openEmailClient} title="Email">
              <Mail className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={sharePdf}
            disabled={sharing}
            title="Share PDF"
          >
            <Share2 className="h-4 w-4" />
            {shareDone === "shared" ? " Shared" : shareDone === "downloaded" ? " Saved" : ""}
          </Button>
          {rx.patient_phone && (
            <Button variant="outline" size="icon" onClick={shareWhatsApp} title="Share via WhatsApp">
              <MessageCircle className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" size="icon" onClick={downloadPdf} title="Download PDF">
            <Download className="h-4 w-4" />
          </Button>
          <Button size="icon" onClick={printSheet} title="Print">
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center p-4 md:p-6">
        {displayData && (
          <div className="mx-auto w-fit origin-top shadow-xl print:hidden" style={{ transform: "scale(0.75)" }}>
            <div ref={hostRef}>
              <PrescriptionSheet data={displayData} />
            </div>
          </div>
        )}
        <p className="mt-6 text-xs text-muted-foreground">
          This is a read-only view of your prescription. Print or save it as a PDF to keep a copy.
        </p>
      </main>
    </div>
  );
}
