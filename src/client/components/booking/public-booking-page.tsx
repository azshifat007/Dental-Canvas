import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CheckCircle2, Clock, Loader2, MapPin, Stethoscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/**
 * Public online-booking page (/book/<token>).
 *
 * What a patient sees after clicking the practice's booking link: clinic
 * identity, a treatment menu, a date picker with real free slots (computed
 * server-side from the agenda), and a short contact form. Booking creates a
 * real appointment on the practice agenda. The token scopes everything —
 * this page can never see other patients or settings.
 */

interface BookingInfo {
  label: string;
  clinic_name: string;
  clinic_address: string;
  doctor_name: string;
  practitioner_name: string | null;
  treatments: { id: number; name: string; duration_minutes: number; default_fee: number }[];
  days_ahead: number;
}

interface Slot {
  time: string;
  label: string;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function PublicBookingPage({ token }: { token: string }) {
  const [info, setInfo] = useState<BookingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [treatmentId, setTreatmentId] = useState<number | null>(null);
  const [date, setDate] = useState<string>(() => isoDate(new Date()));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [form, setForm] = useState({ first_name: "", last_name: "", phone: "", email: "", notes: "" });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/public/booking/${token}`);
        const j = (await res.json()) as BookingInfo & { error?: string };
        if (!res.ok) setError(j.error ?? "This booking link is not available.");
        else setInfo(j);
      } catch {
        setError("Could not reach the clinic's booking service.");
      }
    })();
  }, [token]);

  const dates = useMemo<{ value: string; label: string; sunday: boolean }[]>(() => {
    const out: { value: string; label: string; sunday: boolean }[] = [];
    const today = new Date();
    for (let i = 0; i < (info?.days_ahead ?? 14); i++) {
      const d = new Date(today.getTime() + i * 86_400_000);
      const value = isoDate(d);
      // The server returns no slots on Sundays; still listed but marked.
      const sunday = d.getDay() === 0;
      out.push({
        value,
        label: i === 0 ? "Today" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + (sunday ? " (closed)" : ""),
        sunday,
      });
    }
    return out;
  }, [info?.days_ahead]);

  useEffect(() => {
    if (!info) return;
    let cancelled = false;
    (async () => {
      setSlotsLoading(true);
      setSlot(null);
      try {
        const qs = new URLSearchParams({ date });
        if (treatmentId) qs.set("treatment_id", String(treatmentId));
        const res = await fetch(`/api/public/booking/${token}/slots?${qs}`);
        const j = (await res.json()) as { slots?: Slot[]; error?: string };
        if (!cancelled) setSlots(res.ok ? j.slots ?? [] : []);
      } catch {
        if (!cancelled) setSlots([]);
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [info, token, date, treatmentId]);

  async function submit() {
    if (!slot) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/booking/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim(),
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || undefined,
          notes: form.notes.trim() || undefined,
          start_time: slot.time,
          treatment_type_id: treatmentId,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? "Booking failed — please try another slot.");
        setSlot(null);
      } else {
        setDone(true);
      }
    } catch {
      setError("Could not reach the clinic's booking service.");
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center">
        <div className="max-w-sm">
          <p className="text-lg font-medium">{error}</p>
          <p className="mt-2 text-sm text-muted-foreground">Please contact the clinic directly to book.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
          <h1 className="mt-4 text-xl font-semibold">You're booked!</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {slot && new Date(slot.time).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            {info ? ` at ${info.clinic_name}` : ""}. The clinic will confirm shortly.
          </p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canSubmit = form.first_name.trim() && form.last_name.trim() && slot && !submitting;

  return (
    <div className="min-h-screen bg-background">
      {/* Letterhead */}
      <header className="border-b bg-gradient-to-br from-primary/10 to-transparent px-6 py-8 text-center">
        <div className="mx-auto max-w-lg">
          <h1 className="text-2xl font-semibold tracking-tight">{info.clinic_name}</h1>
          {info.clinic_address && (
            <p className="mt-1 flex items-center justify-center gap-1 text-sm text-muted-foreground">
              <MapPin className="h-3.5 w-3.5" /> {info.clinic_address}
            </p>
          )}
          {info.doctor_name && (
            <p className="mt-1 flex items-center justify-center gap-1 text-sm text-muted-foreground">
              <Stethoscope className="h-3.5 w-3.5" /> {info.doctor_name}
            </p>
          )}
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-sm">
            <CalendarCheck className="h-4 w-4 text-primary" />
            {info.label}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-lg space-y-6 px-6 py-8">
        {/* Step 1 — treatment */}
        {info.treatments.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium">1. Choose a treatment</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {info.treatments.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTreatmentId(t.id === treatmentId ? null : t.id)}
                  className={cn(
                    "rounded-lg border p-3 text-left text-sm transition-colors hover:bg-accent",
                    treatmentId === t.id && "border-primary bg-primary/5 ring-1 ring-primary",
                  )}
                >
                  <span className="font-medium">{t.name}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" /> {t.duration_minutes} min
                    {t.default_fee > 0 && <span>· from {t.default_fee.toFixed(0)}</span>}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Step 2 — date + slot */}
        <section>
          <h2 className="mb-2 text-sm font-medium">
            {info.treatments.length > 0 ? "2. Pick a time" : "1. Pick a time"}
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {dates.map((d) => (
              <button
                key={d.value}
                onClick={() => !d.sunday && setDate(d.value)}
                disabled={d.sunday}
                className={cn(
                  "shrink-0 rounded-lg border px-3 py-2 text-xs transition-colors",
                  d.sunday && "opacity-40",
                  date === d.value ? "border-primary bg-primary/5 font-medium ring-1 ring-primary" : "hover:bg-accent",
                )}
              >
                {d.label}
              </button>
            ))}
          </div>
          <div className="mt-3">
            {slotsLoading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Finding free times…
              </div>
            ) : slots.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">No free times on this day — try another date.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slots.map((s) => (
                  <button
                    key={s.time}
                    onClick={() => setSlot(s)}
                    className={cn(
                      "rounded-lg border px-2 py-2 text-sm transition-colors hover:bg-accent",
                      slot?.time === s.time && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Step 3 — details */}
        <section>
          <h2 className="mb-2 text-sm font-medium">
            {info.treatments.length > 0 ? "3. Your details" : "2. Your details"}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pb-first">First name *</Label>
              <Input id="pb-first" value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-last">Last name *</Label>
              <Input id="pb-last" value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-phone">Phone</Label>
              <Input id="pb-phone" type="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pb-email">Email</Label>
              <Input id="pb-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="pb-notes">Anything we should know? (optional)</Label>
              <Input id="pb-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g. pain in lower left molar" />
            </div>
          </div>
        </section>

        {error && (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200">
            {error}
          </p>
        )}

        <Button className="w-full" size="lg" disabled={!canSubmit} onClick={submit}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Booking…
            </>
          ) : slot ? (
            `Book ${slot.label} on ${new Date(slot.time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
          ) : (
            "Select a time above"
          )}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Booked online — no account needed. The clinic may adjust the time if needed.
        </p>
      </main>
    </div>
  );
}
