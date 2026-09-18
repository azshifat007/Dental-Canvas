import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/api";
import { useApp } from "@/context";
import type { Patient } from "@/types";

const REFERRAL_SOURCES = ["Google", "Facebook", "Yelp", "Friend / family", "Insurance directory", "Walk-in", "Other"];

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** When provided, the dialog edits this patient. Otherwise it creates a new one. */
  patient: Patient | null;
  onSaved?: (patient: Patient) => void;
  /**
   * Called when the user opens a patient's record from the success screen or
   * the duplicate warning (new-patient mode only). When omitted those
   * shortcuts are hidden and creation simply stays in place.
   */
  onOpenPatient?: (patient: Patient) => void;
  /** Label for the success-screen action that opens the record. */
  openPatientLabel?: string;
}

/**
 * Patient registration dialog with a progressive "quick add" flow:
 * creating only requires a name (+ phone); everything else is optional and
 * can be filled in later from the patient record. Editing always shows the
 * full form.
 */
export function PatientDialog({
  open,
  onOpenChange,
  patient,
  onSaved,
  onOpenPatient,
  openPatientLabel = "View record",
}: Props) {
  const app = useApp();
  const isEdit = patient !== null;
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [dob, setDob] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [alerts, setAlerts] = useState("");
  const [referralSource, setReferralSource] = useState<string>("none");
  const [notes, setNotes] = useState("");
  const [showDetails, setShowDetails] = useState(false);
  const [duplicates, setDuplicates] = useState<Patient[]>([]);
  const [created, setCreated] = useState<Patient | null>(null);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setFirst(patient?.first_name ?? "");
    setLast(patient?.last_name ?? "");
    setDob(patient?.date_of_birth ?? "");
    setEmail(patient?.email ?? "");
    setPhone(patient?.phone ?? "");
    setAddress(patient?.address ?? "");
    setAlerts(patient?.medical_alerts ?? "");
    setReferralSource(patient?.referral_source ?? "none");
    setNotes(patient?.notes ?? "");
    setShowDetails(isEdit); // editing shows everything; creating starts minimal
    setDuplicates([]);
    setCreated(null);
  }, [open, patient, isEdit]);

  // Duplicate lookup — only while creating. Searches by phone (when long
  // enough) or last name, then filters client-side for a true name/phone match.
  useEffect(() => {
    if (!open || isEdit) {
      setDuplicates([]);
      return;
    }
    const nameKey = last.trim();
    const phoneKey = phone.trim();
    if (!nameKey && phoneKey.replace(/\D/g, "").length < 7) {
      setDuplicates([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const q = phoneKey.replace(/\D/g, "").length >= 7 ? phoneKey : nameKey;
        const res = await api<{ patients: Patient[] }>("GET", `/api/patients?q=${encodeURIComponent(q)}`);
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
        const fullName = norm(`${first} ${last}`);
        const phoneDigits = phoneKey.replace(/\D/g, "");
        setDuplicates(
          res.patients
            .filter((p) => {
              const sameName = fullName.length > 0 && norm(`${p.first_name} ${p.last_name}`) === fullName;
              const samePhone = phoneDigits.length >= 7 && (p.phone ?? "").replace(/\D/g, "") === phoneDigits;
              return sameName || samePhone;
            })
            .slice(0, 3),
        );
      } catch {
        setDuplicates([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [open, isEdit, first, last, phone]);

  function resetForm() {
    setFirst("");
    setLast("");
    setDob("");
    setEmail("");
    setPhone("");
    setAddress("");
    setAlerts("");
    setReferralSource("none");
    setNotes("");
    setDuplicates([]);
  }

  function addAnother() {
    setCreated(null);
    resetForm();
    // Focus lands back on the first name field for rapid entry.
    setTimeout(() => firstFieldRef.current?.focus(), 0);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!first.trim() || !last.trim()) {
      app.setError("First and last name are required");
      return;
    }
    setSaving(true);
    try {
      const body = {
        first_name: first.trim(),
        last_name: last.trim(),
        date_of_birth: dob.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
        medical_alerts: alerts.trim() || null,
        referral_source: referralSource === "none" ? null : referralSource,
        notes: notes.trim() || null,
      };
      const res = patient
        ? await api<{ patient: Patient }>("PUT", `/api/patients/${patient.id}`, body)
        : await api<{ patient: Patient }>("POST", "/api/patients", body);
      onSaved?.(res.patient);
      if (patient) {
        onOpenChange(false); // editing: close as before
      } else {
        setCreated(res.patient); // creating: show the success screen
        resetForm();
      }
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {created && !isEdit ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <CheckCircle2 className="h-10 w-10 text-emerald-500" />
            <p className="text-base font-semibold">
              {created.first_name} {created.last_name} registered
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Only the essentials were saved. You can add DOB, insurance and the rest anytime from their record.
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={addAnother}>
                <UserPlus className="h-4 w-4" />
                Add another patient
              </Button>
              {onOpenPatient && (
                <Button
                  onClick={() => {
                    onOpenChange(false);
                    onOpenPatient(created);
                  }}
                >
                  {openPatientLabel}
                </Button>
              )}
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{isEdit ? "Edit patient" : "Register patient"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={submit} className="space-y-4">
              {!isEdit && (
                <p className="-mt-1 text-sm text-muted-foreground">
                  Just a name gets them registered — add the rest later from their record.
                </p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="First name *">
                  <Input
                    ref={firstFieldRef}
                    value={first}
                    onChange={(e) => setFirst(e.target.value)}
                    required
                    autoFocus
                  />
                </Field>
                <Field label="Last name *">
                  <Input value={last} onChange={(e) => setLast(e.target.value)} required />
                </Field>
                <Field label="Phone">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Optional" />
                </Field>
                {isEdit && (
                  <Field label="Date of birth">
                    <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                  </Field>
                )}
              </div>

              {isEdit && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Email">
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </Field>
                    <Field label="Address">
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                    </Field>
                  </div>
                  <Field label="Medical alerts (comma-separated)">
                    <Input
                      value={alerts}
                      onChange={(e) => setAlerts(e.target.value)}
                      placeholder="e.g. allergy:penicillin, diabetes, anticoagulant"
                    />
                  </Field>
                  <Field label="How did they hear about us?">
                    <Select value={referralSource} onValueChange={setReferralSource}>
                      <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">— Unknown —</SelectItem>
                        {REFERRAL_SOURCES.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Notes">
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                  </Field>
                </>
              )}

              {!isEdit && (
                <button
                  type="button"
                  onClick={() => setShowDetails((v) => !v)}
                  className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  {showDetails ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  {showDetails ? "Hide details" : "Add details now (optional)"}
                </button>
              )}

              {!isEdit && showDetails && (
                <div className="space-y-4 rounded-lg border bg-muted/30 p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Date of birth">
                      <Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
                    </Field>
                    <Field label="Email">
                      <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                    </Field>
                    <Field label="Address">
                      <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                    </Field>
                    <Field label="How did they hear about us?">
                      <Select value={referralSource} onValueChange={setReferralSource}>
                        <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Unknown —</SelectItem>
                          {REFERRAL_SOURCES.map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <Field label="Medical alerts (comma-separated)">
                    <Input
                      value={alerts}
                      onChange={(e) => setAlerts(e.target.value)}
                      placeholder="e.g. allergy:penicillin, diabetes, anticoagulant"
                    />
                  </Field>
                  <Field label="Notes">
                    <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                  </Field>
                </div>
              )}

              {!isEdit && duplicates.length > 0 && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/60">
                  <div className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4" />
                    Possible duplicate{duplicates.length > 1 ? "s" : ""} found
                  </div>
                  <ul className="mt-1.5 space-y-1">
                    {duplicates.map((d) => (
                      <li key={d.id} className="flex items-center justify-between gap-2 text-amber-900 dark:text-amber-200">
                        <span className="truncate">
                          {d.first_name} {d.last_name}
                          {d.phone ? <span className="text-amber-700 dark:text-amber-300/80"> · {d.phone}</span> : null}
                        </span>
                        {onOpenPatient && (
                          <button
                            type="button"
                            className="shrink-0 text-xs font-semibold text-amber-900 underline hover:no-underline"
                            onClick={() => {
                              onOpenChange(false);
                              onOpenPatient(d);
                            }}
                          >
                            Open
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5 text-xs text-amber-800 dark:text-amber-300/80">
                    Existing records won't be changed — you can still register if this is a different person.
                  </p>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving…" : isEdit ? "Save changes" : "Create patient"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
