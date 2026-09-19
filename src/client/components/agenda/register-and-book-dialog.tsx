import { useEffect, useState } from "react";
import { UserPlus } from "lucide-react";
import { useApp } from "@/context";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { localDateTime } from "@/lib/utils";
import type { Appointment, Patient } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** The agenda day currently being viewed — the appointment is booked on it. */
  date: string;
  /** Called after the patient + appointment are created (parent refreshes the day). */
  onBooked?: (patient: Patient, appointment: Appointment) => void;
}

function toHHMM(mins: number): string {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
  return h * 60 + m;
}

/**
 * One dialog for the classic front-desk moment: a brand-new caller who needs
 * to be registered AND given their first appointment. Creates the patient,
 * then books the appointment for them — two records, one submit.
 */
export function RegisterAndBookDialog({ open, onOpenChange, date, onBooked }: Props) {
  const app = useApp();
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [phone, setPhone] = useState("");
  const [operatoryId, setOperatoryId] = useState<number | null>(null);
  const [practitionerId, setPractitionerId] = useState<number | null>(null);
  const [treatmentTypeId, setTreatmentTypeId] = useState<number | null>(null);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("09:30");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset to sensible defaults each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setFirst("");
    setLast("");
    setPhone("");
    setOperatoryId(app.operatories[0]?.id ?? null);
    setPractitionerId(null);
    setTreatmentTypeId(null);
    setStartTime("09:00");
    setEndTime("09:30");
    setNotes("");
  }, [open, app.operatories]);

  // When treatment type changes, size the visit accordingly.
  useEffect(() => {
    if (!treatmentTypeId || !startTime) return;
    const tt = app.treatmentTypes.find((t) => t.id === treatmentTypeId);
    if (!tt) return;
    const startMin = parseHHMM(startTime);
    if (Number.isNaN(startMin)) return;
    setEndTime(toHHMM(startMin + tt.duration_minutes));
  }, [treatmentTypeId, startTime, app.treatmentTypes]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!first.trim() || !last.trim()) {
      app.setError("Enter the patient's first and last name");
      return;
    }
    if (!operatoryId) {
      app.setError("Select an operatory");
      return;
    }
    const startMin = parseHHMM(startTime);
    const endMin = parseHHMM(endTime);
    if (Number.isNaN(startMin) || Number.isNaN(endMin) || endMin <= startMin) {
      app.setError("End time must be after start time");
      return;
    }
    setSaving(true);
    try {
      const created = await app.createPatient({
        first_name: first.trim(),
        last_name: last.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      const appointment = await app.createAppointment({
        operatory_id: operatoryId,
        practitioner_id: practitionerId ?? undefined,
        treatment_type_id: treatmentTypeId ?? undefined,
        patient_id: created.id,
        start_time: localDateTime(date, startMin),
        end_time: localDateTime(date, endMin),
        status: "scheduled",
        kind: "patient",
        notes: notes.trim() || null,
      });
      onOpenChange(false);
      onBooked?.(created, appointment);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" /> Register &amp; book
          </DialogTitle>
        </DialogHeader>
        <p className="-mt-1 text-sm text-muted-foreground">
          Creates the patient and their first appointment on {date} in one step.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">First name *</Label>
              <Input value={first} onChange={(e) => setFirst(e.target.value)} required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Last name *</Label>
              <Input value={last} onChange={(e) => setLast(e.target.value)} required />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Operatory *</Label>
              <Select value={operatoryId?.toString() ?? ""} onValueChange={(v) => setOperatoryId(parseInt(v, 10))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {app.operatories.map((o) => (
                    <SelectItem key={o.id} value={o.id.toString()}>{o.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Practitioner</Label>
              <Select value={practitionerId?.toString() ?? "none"} onValueChange={(v) => setPractitionerId(v === "none" ? null : parseInt(v, 10))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {app.practitioners.map((p) => (
                    <SelectItem key={p.id} value={p.id.toString()}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Treatment</Label>
              <Select value={treatmentTypeId?.toString() ?? "none"} onValueChange={(v) => setTreatmentTypeId(v === "none" ? null : parseInt(v, 10))}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {app.treatmentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>{t.code} · {t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Start *</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">End *</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Optional" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Booking…" : "Register & book"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
