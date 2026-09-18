import { useCallback, useEffect, useState } from "react";
import { FileText, Plus, Printer, Share2, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import type { Prescription, PrescriptionItem, PrescriptionTemplate } from "@/types";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TemplatePickerGrid } from "./template-picker";

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
                <th className="px-3 py-2 font-semibold">Shared</th>
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
                    {rx.share_token && !rx.share_revoked ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                        <Share2 className="h-3 w-3" /> Active link
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigate(`/patients/${patientId}/prescriptions/${rx.id}`)}
                      >
                        <Printer className="h-4 w-4" /> Print
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
        open={creating || editing !== null}
        onOpenChange={(o) => {
          if (!o) {
            setCreating(false);
            setEditing(null);
          }
        }}
        patientId={patientId}
        prescription={editing}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          reload();
        }}
        onOpenPrint={(id) => {
          setCreating(false);
          setEditing(null);
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

function PrescriptionDialog({
  open,
  onOpenChange,
  patientId,
  prescription,
  onSaved,
  onOpenPrint,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patientId: number;
  prescription: Prescription | null;
  onSaved: () => void;
  onOpenPrint: (id: number) => void;
}) {
  const app = useApp();
  const isEdit = prescription !== null;
  const [issuedDate, setIssuedDate] = useState("");
  const [template, setTemplate] = useState<PrescriptionTemplate>("classic");
  const [practitionerId, setPractitionerId] = useState<string>("none");
  const [diagnosis, setDiagnosis] = useState("");
  const [advice, setAdvice] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [items, setItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setIssuedDate(prescription?.issued_date ?? new Date().toISOString().slice(0, 10));
    setTemplate(prescription?.template ?? "classic");
    setPractitionerId(prescription?.practitioner_id ? String(prescription.practitioner_id) : "none");
    setDiagnosis(prescription?.diagnosis ?? "");
    setAdvice(prescription?.advice ?? "");
    setFollowUp(prescription?.follow_up ?? "");
    const existing = prescription?.items ?? [];
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
  }, [open, prescription]);

  function setItem(index: number, patch: Partial<DraftItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  function addRow() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeRow(index: number) {
    setItems((prev) => (prev.length === 1 ? [{ ...EMPTY_ITEM }] : prev.filter((_, i) => i !== index)));
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
      const res = isEdit
        ? await api<{ prescription: Prescription }>("PUT", `/api/prescriptions/${prescription!.id}`, body)
        : await api<{ prescription: Prescription }>("POST", "/api/prescriptions", body);
      onSaved();
      if (thenPrint) onOpenPrint(res.prescription.id);
    } catch (err) {
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

          <div className="space-y-1.5">
            <Label className="text-xs">Diagnosis</Label>
            <Input
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g. Acute periapical abscess, tooth 36"
            />
          </div>

          {/* Medication rows */}
          <div className="space-y-2">
            <Label className="text-xs">Medications *</Label>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1.5fr_auto]">
                  <Input
                    value={item.drug_name}
                    onChange={(e) => setItem(i, { drug_name: e.target.value })}
                    placeholder="Drug (required)"
                    className="h-9"
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
            <Button type="submit" variant="secondary" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
            <Button type="button" disabled={saving} onClick={(e) => save(e as unknown as React.FormEvent, true)}>
              Save &amp; print
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
