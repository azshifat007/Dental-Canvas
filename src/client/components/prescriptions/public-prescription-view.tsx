import { useEffect, useState } from "react";
import { api } from "@/api";
import type { Prescription, PrescriptionTemplate } from "@/types";
import { PrescriptionSheet, isPrescriptionTemplate, type PrescriptionSheetData } from "./prescription-sheet";

/**
 * Public, read-only prescription page reached via an unguessable share link
 * (/p/<token>). Renders bare — no app shell — and shows only what the sheet
 * itself contains (the server deliberately omits patient contact fields).
 */
export function PublicPrescriptionView({ token }: { token: string }) {
  const [sheet, setSheet] = useState<PrescriptionSheetData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api<{
          prescription: Prescription & {
            practice: {
              doctor_name: string;
              doctor_specialty: string;
              doctor_license: string;
              clinic_name: string;
              clinic_address: string;
              doctor_phone: string;
            };
          };
        }>("GET", `/api/public/prescriptions/${token}`);
        if (cancelled) return;
        const rx = res.prescription;
        const practice = rx.practice;
        setSheet({
          doctor_name: practice.doctor_name,
          doctor_specialty: practice.doctor_specialty,
          doctor_license: practice.doctor_license,
          clinic_name: practice.clinic_name,
          clinic_address: practice.clinic_address,
          clinic_phone: practice.doctor_phone,
          patient_name: `${rx.patient_first_name ?? ""} ${rx.patient_last_name ?? ""}`.trim() || "Patient",
          patient_age: ageFromDob(rx.patient_date_of_birth ?? null),
          practitioner_name: rx.practitioner_name,
          issued_date: rx.issued_date,
          template: isPrescriptionTemplate(rx.template) ? rx.template : "classic",
          diagnosis: rx.diagnosis,
          advice: rx.advice,
          follow_up: rx.follow_up,
          items: rx.items ?? [],
        });
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div className="max-w-sm rounded-xl border bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Link not available</h1>
          <p className="mt-2 text-sm text-slate-600">
            This prescription link is invalid or was revoked by the practice.
          </p>
        </div>
      </div>
    );
  }

  if (!sheet) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
        Loading prescription…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 py-6" style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <PrescriptionSheet data={sheet} />
      <p className="mx-auto mt-4 max-w-[210mm] px-4 text-center text-xs text-slate-500">
        This document was shared securely by the practice. Anyone with the link can view it — the practice can revoke access at any time.
      </p>
    </div>
  );
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
