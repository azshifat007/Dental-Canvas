import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Check, Download, Link2, Link2Off, Printer } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import type { Prescription, PrescriptionTemplate } from "@/types";
import { PrescriptionSheet, isPrescriptionTemplate } from "./prescription-sheet";
import { TemplateDropdown } from "./template-picker";

/**
 * In-app prescription print/share view: shows the A4 sheet scaled to the
 * viewport, with a toolbar for printing, downloading, template switching and
 * share-link management. The public share page renders the same sheet bare.
 */

const TEMPLATE_LABELS: Record<PrescriptionTemplate, string> = {
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

  /** Print by cloning the sheet markup into a dedicated iframe. */
  const printSheet = useCallback(() => {
    const host = printHostRef.current;
    if (!host) return;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prescription</title>
      <style>
        @page { size: A4; margin: 0; }
        html, body { margin: 0; padding: 0; background: #ffffff; }
        @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style></head><body>${host.innerHTML}</body></html>`);
    doc.close();
    const done = () => {
      window.setTimeout(() => frame.remove(), 500);
      frame.removeEventListener("load", done);
    };
    frame.addEventListener("load", () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      done();
    });
  }, []);

  const downloadSheet = useCallback(() => {
    const host = printHostRef.current;
    if (!host || !rx) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Prescription ${rx.id}</title>
      <style>@page { size: A4; margin: 0; } html,body{margin:0;padding:0;background:#fff;}</style>
      </head><body>${host.innerHTML}</body></html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prescription-${(rx.patient_last_name ?? "patient").toLowerCase().replace(/\s+/g, "-")}-${rx.issued_date}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rx]);

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
          <ShareButton rx={rx} onUpdated={setRx} />
          <button onClick={downloadSheet} className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent">
            <Download className="h-4 w-4" /> Download
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
    </div>
  );
}

/** Create / rotate / revoke + copy the public link. */
function ShareButton({ rx, onUpdated }: { rx: Prescription; onUpdated: (rx: Prescription) => void }) {
  const app = useApp();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const shareUrl = rx.share_token && !rx.share_revoked ? `${window.location.origin}/p/${rx.share_token}` : null;

  async function createOrRotate() {
    setBusy(true);
    try {
      const res = await api<{ share_token: string }>("POST", `/api/prescriptions/${rx.id}/share`);
      onUpdated({ ...rx, share_token: res.share_token, share_revoked: 0 });
      await copyLink(`${window.location.origin}/p/${res.share_token}`);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — the link is still shown in the dialog below */
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      await api("DELETE", `/api/prescriptions/${rx.id}/share`);
      onUpdated({ ...rx, share_token: null, share_revoked: 0 });
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      {shareUrl ? (
        <>
          <button
            onClick={() => copyLink(shareUrl)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent"
            title={shareUrl}
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            onClick={revoke}
            disabled={busy}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-2.5 text-sm text-destructive hover:bg-destructive/10"
            title="Revoke the public link — anyone with it loses access immediately"
          >
            <Link2Off className="h-4 w-4" />
          </button>
        </>
      ) : (
        <button
          onClick={createOrRotate}
          disabled={busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent"
        >
          <Link2 className="h-4 w-4" /> Share
        </button>
      )}
    </div>
  );
}

/** Compose what the sheet needs from the prescription row + practice profile. */
export function buildSheetData(rx: Prescription, profile: { doctor_name: string; doctor_specialty: string; doctor_license: string; clinic_name: string; clinic_address: string; doctor_phone: string }) {
  const alerts = (rx.patient_medical_alerts ?? "").split(",").map((s) => s.trim()).filter(Boolean).join(", ");
  return {
    clinic_name: profile.clinic_name,
    clinic_address: profile.clinic_address,
    clinic_phone: profile.doctor_phone,
    doctor_name: profile.doctor_name || "Doctor",
    doctor_specialty: profile.doctor_specialty,
    doctor_license: profile.doctor_license,
    patient_name: `${rx.patient_first_name ?? ""} ${rx.patient_last_name ?? ""}`.trim() || "Patient",
    patient_age: ageFromDob(rx.patient_date_of_birth ?? null),
    patient_medical_alerts: alerts || null,
    practitioner_name: rx.practitioner_name ?? null,
    issued_date: rx.issued_date,
    template: isPrescriptionTemplate(rx.template) ? rx.template : "classic",
    diagnosis: rx.diagnosis,
    advice: rx.advice,
    follow_up: rx.follow_up,
    items: rx.items ?? [],
  };
}

function ageFromDob(dob: string | null): string | null {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return `${age} yrs`;
}
