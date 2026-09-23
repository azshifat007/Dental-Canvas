import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Loader2,
  Sparkles,
  Stethoscope,
} from "lucide-react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProfileSettings } from "@/hooks/use-app-state";

/**
 * First-run setup wizard (desktop only).
 *
 * A fresh offline install starts with an empty profile — no doctor name, no
 * clinic name — which the rest of the app (dashboard greeting, prescription
 * letterheads, invoices) depends on. This wizard collects the essentials in
 * two friendly steps before the app is usable, writing through the same
 * settings API that Settings → Profile uses, so everything it fills in is
 * immediately editable there later.
 *
 * It renders as a full-screen takeover with no app chrome; the shell mounts
 * the real app underneath so the first dashboard load is already warm.
 */

interface Draft {
  doctor_name: string;
  doctor_specialty: string;
  doctor_phone: string;
  doctor_email: string;
  doctor_license: string;
  clinic_name: string;
  clinic_address: string;
}

const STEPS = [
  { id: 1, title: "The doctor", icon: Stethoscope },
  { id: 2, title: "The clinic", icon: Building2 },
] as const;

export function SetupWizard({ onDone }: { onDone: () => void }) {
  const { updateProfile } = useApp();
  const [step, setStep] = useState<1 | 2>(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({
    doctor_name: "",
    doctor_specialty: "Dentist",
    doctor_phone: "",
    doctor_email: "",
    doctor_license: "",
    clinic_name: "",
    clinic_address: "",
  });

  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [k]: e.target.value }));

  const doctorOk = draft.doctor_name.trim().length > 0;
  const clinicOk = draft.clinic_name.trim().length > 0;

  async function finish() {
    setSaving(true);
    setError(null);
    try {
      // Only send non-empty fields — skipping optional ones keeps any
      // existing defaults (e.g. specialty) intact.
      const patch: Partial<ProfileSettings> = {};
      for (const [k, v] of Object.entries(draft)) {
        if (v.trim() !== "") patch[k as keyof ProfileSettings] = v.trim();
      }
      await updateProfile(patch);
      onDone();
    } catch (err) {
      setError((err as Error).message || "Saving failed — try again.");
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border bg-card shadow-2xl">
        {/* Header */}
        <div className="border-b bg-gradient-to-br from-primary/10 to-transparent px-8 pb-6 pt-8">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="h-4 w-4" />
            Welcome to Dental Canvas
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            Let&apos;s set up your practice
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Two quick steps — you can change everything later in Settings →
            Profile.
          </p>
          {/* Progress dots */}
          <div className="mt-5 flex items-center gap-2">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <div
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                    step > s.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : step === s.id
                        ? "border-primary text-primary"
                        : "border-border text-muted-foreground",
                  )}
                >
                  {step > s.id ? <Check className="h-3.5 w-3.5" /> : s.id}
                </div>
                <span
                  className={cn(
                    "text-xs",
                    step === s.id ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {s.title}
                </span>
                {i < STEPS.length - 1 && (
                  <div className="h-px w-10 bg-border" role="separator" />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="space-y-4 px-8 py-6">
          {step === 1 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="wiz-doctor-name">
                    Doctor&apos;s name <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="wiz-doctor-name"
                    placeholder="Dr. Sarah Ahmed"
                    value={draft.doctor_name}
                    onChange={set("doctor_name")}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-specialty">Specialty</Label>
                  <Input
                    id="wiz-specialty"
                    placeholder="Dentist"
                    value={draft.doctor_specialty}
                    onChange={set("doctor_specialty")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-license">License / Reg. no.</Label>
                  <Input
                    id="wiz-license"
                    placeholder="Optional"
                    value={draft.doctor_license}
                    onChange={set("doctor_license")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-doctor-phone">Phone</Label>
                  <Input
                    id="wiz-doctor-phone"
                    type="tel"
                    placeholder="Optional"
                    value={draft.doctor_phone}
                    onChange={set("doctor_phone")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-doctor-email">Email</Label>
                  <Input
                    id="wiz-doctor-email"
                    type="email"
                    placeholder="Optional"
                    value={draft.doctor_email}
                    onChange={set("doctor_email")}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The doctor&apos;s name appears on the dashboard greeting,
                prescriptions, and invoices.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-clinic-name">
                    Clinic name <span className="text-rose-500">*</span>
                  </Label>
                  <Input
                    id="wiz-clinic-name"
                    placeholder="Bright Smile Dental Care"
                    value={draft.clinic_name}
                    onChange={set("clinic_name")}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-clinic-address">Clinic address</Label>
                  <Input
                    id="wiz-clinic-address"
                    placeholder="Optional"
                    value={draft.clinic_address}
                    onChange={set("clinic_address")}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                The clinic name is printed on prescription and invoice
                letterheads. You can upload a logo from Settings → Profile
                after setup.
              </p>
            </>
          )}

          {error && (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-8 py-4">
          <Button
            variant="ghost"
            onClick={() => (step === 1 ? onDone() : setStep(1))}
            disabled={saving}
          >
            {step === 1 ? (
              "Skip for now"
            ) : (
              <>
                <ArrowLeft className="h-4 w-4" /> Back
              </>
            )}
          </Button>
          {step === 1 ? (
            <Button onClick={() => setStep(2)} disabled={!doctorOk || saving}>
              Next <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={finish} disabled={!clinicOk || saving}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" /> Finish setup
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
