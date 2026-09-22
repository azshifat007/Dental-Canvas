import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, FileText, Plus, Printer, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { toast } from "@/components/ui/toast";
import type {
  Patient,
  PatientImage,
  Prescription,
  PrescriptionItem,
  PrescriptionTemplate,
  TreatmentPlanItem,
} from "@/types";
import { formatDate } from "@/lib/utils";
import { PrescriptionPreviewModal } from "./prescription-preview-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TemplatePickerGrid } from "./template-picker";
import type { PrescriptionSheetData } from "./prescription-sheet";
import { DrugAutocomplete } from "./drug-autocomplete";
import type { DrugPreset } from "@/lib/dental-drugs";

/**
 * Prescriptions tab on the patient record: lists issued prescriptions and
 * provides the create/edit dialog. Printing, sharing and template switching
 * live in PrescriptionPrintView, opened from a row's Print action.
 */
export function PrescriptionsTab({
  patientId,
  navigate,
}: {
  patientId: number;
  navigate: (to: string) => void;
}) {
  const app = useApp();
  const [list, setList] = useState<Prescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Prescription | null>(null);
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState<Prescription | null>(null);
  // Patient display name for the preview sheet's patient block.
  const [patientName, setPatientName] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<{ patient: Patient }>("GET", `/api/patients/${patientId}`)
      .then((res) => {
        if (!cancelled) {
          setPatientName(`${res.patient.first_name ?? ""} ${res.patient.last_name ?? ""}`.trim());
        }
      })
      .catch(() => {
        /* preview falls back to "Patient" — not worth an error banner */
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  const reload = useCallback(async () => {
    try {
      const res = await api<{ prescriptions: Prescription[] }>("GET", `/api/patients/${patientId}/prescriptions`);
      setList(res.prescriptions);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function remove(id: number) {
    if (!confirm("Delete this prescription? This cannot be undone.")) return;
    try {
      await api("DELETE", `/api/prescriptions/${id}`);
      setList((prev) => prev.filter((p) => p.id !== id));
      toast.success("Prescription deleted");
    } catch (err) {
      toast.error((err as Error).message);
      app.setError((err as Error).message);
    }
  }

  /** Fetch the full prescription (with items) and open the editor pre-filled as a new one. */
  async function duplicate(rx: Prescription) {
    try {
      const res = await api<{ prescription: Prescription }>("GET", `/api/prescriptions/${rx.id}`);
      setDuplicating(res.prescription);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Prescriptions issued to this patient. Print on A4 or share a secure link.
        </p>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> New prescription
        </Button>
      </div>

      {loading ? (
        <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">Loading…</div>
      ) : list.length === 0 ? (
        <div className="rounded-md border border-dashed p-10 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm text-muted-foreground">No prescriptions yet.</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Write the first one
          </Button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Medications</th>
                <th className="px-3 py-2 font-semibold">Prescriber</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {list.map((rx) => (
                <tr key={rx.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{formatDate(rx.issued_date)}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {rx.item_count ?? 0} medication{(rx.item_count ?? 0) === 1 ? "" : "s"}
                    {rx.diagnosis ? <span className="block text-xs">dx: {rx.diagnosis}</span> : null}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{rx.practitioner_name ?? "—"}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/patients/${patientId}/prescriptions/${rx.id}`)}
                      >
                        <Printer className="h-4 w-4" /> Print
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => duplicate(rx)}
                        className="text-muted-foreground"
                        title="Duplicate"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => setEditing(rx)} title="Edit">
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => remove(rx.id)}
                        className="text-muted-foreground hover:text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <PrescriptionDialog
        open={creating || editing !== null || duplicating !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
            setDuplicating(null);
          }
        }}
        patientId={patientId}
        patientName={patientName}
        prescription={editing}
        duplicateOf={duplicating}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          setDuplicating(null);
          reload();
        }}
        onOpenPrint={(id) => {
          setCreating(false);
          setEditing(null);
          setDuplicating(null);
          navigate(`/patients/${patientId}/prescriptions/${id}`);
        }}
      />
    </div>
  );
}

interface DraftItem {
  drug_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

const EMPTY_ITEM: DraftItem = { drug_name: "", dosage: "", frequency: "", duration: "", instructions: "" };

/**
 * The prescription editor dialog. Exported so the dashboard's consultation
 * card can mount the same editor for issuing a prescription mid-visit.
 */
export function PrescriptionDialog({
  open,
  onOpenChange,
  patientId,
  patientName,
  prescription,
  duplicateOf,
  onSaved,
  onOpenPrint,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patientId: number;
  /** Display name for the preview sheet's patient block. */
  patientName: string;
  prescription: Prescription | null;
  /** Source prescription when duplicating — prefills everything but stays a new record. */
  duplicateOf: Prescription | null;
  onSaved: () => void;
  onOpenPrint: (id: number) => void;
}) {
  const app = useApp();
  const isEdit = prescription !== null;
  const [issuedDate, setIssuedDate] = useState("");
  const [template, setTemplate] = useState<PrescriptionTemplate>("chamber");
  const [largePrint, setLargePrint] = useState(false);
  const [tooth, setTooth] = useState("");
  const [planItemId, setPlanItemId] = useState<string>("none");
  /** The patient's treatment-plan items, loaded once for the plan picker. */
  const [planItems, setPlanItems] = useState<TreatmentPlanItem[]>([]);
  const [practitionerId, setPractitionerId] = useState<string>("none");
  const [diagnosis, setDiagnosis] = useState("");
  const [advice, setAdvice] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [items, setItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Images attachable to the sheet (X-ray/intraoral/panoramic on file) and the
  // ids currently selected to print on it.
  const [attachOptions, setAttachOptions] = useState<PatientImage[]>([]);
  const [imageIds, setImageIds] = useState<number[]>([]);

  // Load the plan items for the picker (only while the dialog is open).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api<{ items: TreatmentPlanItem[] }>("GET", `/api/patients/${patientId}/treatment-plan`)
      .then((res) => {
        if (!cancelled) setPlanItems(res.items);
      })
      .catch(() => {
        /* picker just stays empty */
      });
    return () => {
      cancelled = true;
    };
  }, [open, patientId]);

  useEffect(() => {
    if (!open) return;
    const source = prescription ?? duplicateOf;
    setIssuedDate(prescription?.issued_date ?? new Date().toISOString().slice(0, 10));
    setTemplate(source?.template ?? "chamber");
    setLargePrint(Boolean(source?.large_print));
    setTooth(source?.tooth ?? "");
    setPlanItemId(source?.plan_item_id ? String(source.plan_item_id) : "none");
    setPractitionerId(source?.practitioner_id ? String(source.practitioner_id) : "none");
    setDiagnosis(source?.diagnosis ?? "");
    setAdvice(source?.advice ?? "");
    setFollowUp(source?.follow_up ?? "");
    const existing = source?.items ?? [];
    setItems(
      existing.length > 0
        ? existing.map((i: PrescriptionItem) => ({
            drug_name: i.drug_name,
            dosage: i.dosage ?? "",
            frequency: i.frequency ?? "",
            duration: i.duration ?? "",
            instructions: i.instructions ?? "",
          }))
        : [{ ...EMPTY_ITEM }],
    );
    // Attached images. The list row only carries image_ids (as JSON text), so
    // in edit mode fetch the full record for the renderable thumbnails.
    if (prescription && !(source?.images?.length)) {
      let cancelled = false;
      api<{ prescription: Prescription }>("GET", `/api/prescriptions/${prescription.id}`)
        .then((res) => {
          if (cancelled) return;
          setAttachOptions(res.prescription.images ?? []);
          setImageIds(res.prescription.image_ids ?? []);
        })
        .catch((err) => app.setError((err as Error).message));
      return () => {
        cancelled = true;
      };
    }
    setAttachOptions(source?.images ?? []);
    setImageIds(source?.image_ids ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prescription, duplicateOf, patientId]);

  /** Auto-fill tooth + X-ray from the record when creating a fresh prescription. */
  useEffect(() => {
    if (!open || prescription || duplicateOf) return;
    let cancelled = false;
    api<{ tooth: string | null; images: PatientImage[]; storage: { enabled: boolean } }>(
      "GET",
      `/api/patients/${patientId}/prescription-context`,
    )
      .then((ctx) => {
        if (cancelled) return;
        if (ctx.tooth) setTooth((t) => t || ctx.tooth!);
        const opts = ctx.images ?? [];
        setAttachOptions(opts);
        // Auto-attach the most recent X-ray so the sheet reflects today's film.
        const latest = opts.find((i) => i.url);
        if (latest) setImageIds([latest.id]);
      })
      .catch(() => {
        /* context is best-effort — the sheet works without it */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, patientId, prescription, duplicateOf]);

  function setItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  /**
   * Choosing a plan procedure autofills the tooth and, when the diagnosis is
   * empty, suggests the procedure name — one pick instead of four typed fields.
   * Editing fields afterwards is always allowed.
   */
  function pickPlanItem(value: string) {
    setPlanItemId(value);
    if (value === "none") return;
    const item = planItems.find((p) => String(p.id) === value);
    if (!item) return;
    if (item.tooth) setTooth(item.tooth);
    setDiagnosis((d) => d.trim() || item.treatment_name || d);
  }

  function addRow() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  /** Committing a preset fills dosage/frequency/duration/instructions for that row. */
  function applyPreset(index: number, preset: DrugPreset) {
    setItem(index, {
      dosage: preset.dosage,
      frequency: preset.frequency,
      duration: preset.duration,
      instructions: preset.instructions,
    });
  }

  function removeRow(index: number) {
    setItems((prev) => (prev.length === 1 ? [{ ...EMPTY_ITEM }] : prev.filter((_, i) => i !== index)));
  }

  /** The sheet as it would print right now, from the unsaved draft. */
  function draftSheetData(): PrescriptionSheetData | null {
    const valid = items.filter((i) => i.drug_name.trim());
    if (valid.length === 0) {
      app.setError("Add at least one medication to preview.");
      return null;
    }
    const prescriber = app.practitioners.find((p) => String(p.id) === practitionerId);
    return {
      clinic_name: app.profile.clinic_name || null,
      clinic_address: app.profile.clinic_address || null,
      clinic_phone: app.profile.doctor_phone || null,
      clinic_logo: app.profile.clinic_logo || null,
      chamber_footer_instructions: app.profile.chamber_footer_instructions?.trim() || null,
      doctor_name: app.profile.doctor_name || "Doctor",
      doctor_specialty: app.profile.doctor_specialty || null,
      doctor_license: app.profile.doctor_license || null,
      patient_name: patientName || "Patient",
      practitioner_name: prescriber?.name ?? null,
      issued_date: issuedDate,
      template,
      large_print: largePrint,
      tooth: tooth.trim() || null,
      plan_treatment_name: planItems.find((p) => String(p.id) === planItemId)?.treatment_name ?? null,
      images: attachOptions
        .filter((o) => imageIds.includes(o.id))
        .map((o) => ({ id: o.id, label: o.label, src: o.url })),
      diagnosis: diagnosis.trim() || null,
      advice: advice.trim() || null,
      follow_up: followUp.trim() || null,
      items: valid.map((i) => ({
        drug_name: i.drug_name.trim(),
        dosage: i.dosage.trim() || null,
        frequency: i.frequency.trim() || null,
        duration: i.duration.trim() || null,
        instructions: i.instructions.trim() || null,
      })),
    };
  }

  function openPreview() {
    if (draftSheetData()) setPreviewOpen(true);
  }

  async function save(e: React.FormEvent, thenPrint: boolean) {
    e.preventDefault();
    const valid = items.filter((i) => i.drug_name.trim());
    if (valid.length === 0) {
      app.setError("Add at least one medication with a drug name.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        patient_id: patientId,
        practitioner_id: practitionerId === "none" ? null : Number(practitionerId),
        issued_date: issuedDate || null,
        template,
        large_print: largePrint,
        tooth: tooth.trim() || null,
        plan_item_id: planItemId === "none" ? null : Number(planItemId),
        diagnosis: diagnosis.trim() || null,
        advice: advice.trim() || null,
        follow_up: followUp.trim() || null,
        image_ids: imageIds,
        items: valid.map((i) => ({
          drug_name: i.drug_name.trim(),
          dosage: i.dosage.trim() || null,
          frequency: i.frequency.trim() || null,
          duration: i.duration.trim() || null,
          instructions: i.instructions.trim() || null,
        })),
      };
      // Duplicate mode passes prescription=null, so this naturally creates a new record.
      const res =
        isEdit && !duplicateOf
          ? await api<{ prescription: Prescription }>("PUT", `/api/prescriptions/${prescription!.id}`, body)
          : await api<{ prescription: Prescription }>("POST", "/api/prescriptions", body);
      toast.success(
        isEdit && !duplicateOf
          ? "Prescription updated"
          : `Prescription issued with ${valid.length} medication${valid.length === 1 ? "" : "s"}`,
      );
      onSaved();
      if (thenPrint) onOpenPrint(res.prescription.id);
    } catch (err) {
      toast.error((err as Error).message);
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit prescription" : "New prescription"}</DialogTitle>
          {duplicateOf !== null ? (
            <DialogDescription>
              Duplicating the prescription from{" "}
              {duplicateOf.issued_date ? formatDate(duplicateOf.issued_date) : "an earlier visit"} — medications,
              diagnosis and advice are copied; the issue date is today.
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <form onSubmit={(e) => save(e, false)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date</Label>
              <Input type="date" value={issuedDate} onChange={(e) => setIssuedDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Prescriber</Label>
              <Select value={practitionerId} onValueChange={setPractitionerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Practice default —</SelectItem>
                  {app.practitioners.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-3">
              <Label className="text-xs">Template</Label>
              <TemplatePickerGrid value={template} onChange={setTemplate} />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-md border bg-muted/30 px-3 py-2.5">
            <input
              type="checkbox"
              checked={largePrint}
              onChange={(e) => setLargePrint(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            <span className="text-sm">
              Large print
              <span className="block text-xs text-muted-foreground">
                Enlarged medication and advice text for visually impaired patients.
              </span>
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Linked procedure</Label>
              <Select value={planItemId} onValueChange={pickPlanItem}>
                <SelectTrigger>
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {planItems.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.treatment_name ?? "Treatment"}
                      {p.tooth ? ` · tooth ${p.tooth}` : ""}
                      {p.treatment_code ? ` (${p.treatment_code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tooth</Label>
              <Input
                value={tooth}
                onChange={(e) => setTooth(e.target.value)}
                placeholder="e.g. 36"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Diagnosis</Label>
              <Input
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                placeholder="e.g. Acute periapical abscess, tooth 36"
              />
            </div>
          </div>

          {/* Attach X-ray / intraoral images */}
          {attachOptions.length > 0 && (
            <div className="rounded-md border bg-muted/20 p-3">
              <Label className="text-xs">
                Attach images <span className="font-normal text-muted-foreground">— they print on the sheet</span>
              </Label>
              <div className="mt-2 flex flex-wrap gap-2">
                {attachOptions.map((img) => {
                  const on = imageIds.includes(img.id);
                  return (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => {
                        setImageIds((prev) => (on ? prev.filter((i) => i !== img.id) : [...prev, img.id]));
                      }}
                      title={img.label || img.file_name || `Image #${img.id}`}
                      className={
                        on
                          ? "relative overflow-hidden rounded-md border-2 border-primary"
                          : "relative overflow-hidden rounded-md border-2 border-transparent opacity-60 hover:opacity-100"
                      }
                    >
                      {img.url ? (
                        <img src={img.url} alt={img.label || img.file_name || "X-ray"} className="h-16 w-20 object-cover" />
                      ) : (
                        <div className="flex h-16 w-20 items-center justify-center bg-muted text-[10px] text-muted-foreground">
                          {img.kind === "xray" ? "X-ray" : img.kind}
                        </div>
                      )}
                      {on && (
                        <span className="absolute inset-0 flex items-center justify-center bg-primary/20 text-xs font-bold text-white">
                          ✓
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Medication rows */}
          <div className="space-y-2">
            <Label className="text-xs">Medications *</Label>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1.5fr_auto]">
                  <DrugAutocomplete
                    inputId={`drug-${i}`}
                    value={item.drug_name}
                    onChange={(v) => setItem(i, { drug_name: v })}
                    onPick={(preset) => applyPreset(i, preset)}
                    required
                  />
                  <Input value={item.dosage} onChange={(e) => setItem(i, { dosage: e.target.value })} placeholder="500 mg" className="h-9" />
                  <Input value={item.frequency} onChange={(e) => setItem(i, { frequency: e.target.value })} placeholder="3x daily" className="h-9" />
                  <Input value={item.duration} onChange={(e) => setItem(i, { duration: e.target.value })} placeholder="5 days" className="h-9" />
                  <Input value={item.instructions} onChange={(e) => setItem(i, { instructions: e.target.value })} placeholder="after meals" className="h-9" />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} className="h-9 w-9 text-muted-foreground" title="Remove">
                    ✕
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" /> Add medication
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Advice</Label>
            <Textarea
              value={advice}
              onChange={(e) => setAdvice(e.target.value)}
              rows={2}
              placeholder="e.g. Rinse with warm salt water; return if swelling worsens."
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Follow-up</Label>
            <Input value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="e.g. Recheck in 2 weeks" />
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" variant="outline" disabled={saving} onClick={openPreview}>
              <Eye className="h-4 w-4" /> Preview
            </Button>
            <Button type="submit" variant="secondary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button type="button" disabled={saving} onClick={(e) => save(e as unknown as React.FormEvent, true)}>
              Save &amp; print
            </Button>
          </DialogFooter>
        </form>

        {previewOpen && draftSheetData() && (
          <PrescriptionPreviewModal
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            data={draftSheetData()!}
            title={`Preview — ${patientName || "Patient"}`}
            onTemplateChange={setTemplate}
            onLargePrintChange={setLargePrint}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
