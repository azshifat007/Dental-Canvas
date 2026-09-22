import { useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, ClipboardCheck, RefreshCw, UserRound } from "lucide-react";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import type { ConsentTemplate } from "@/types";

/**
 * Self check-in kiosk — a full-screen tablet page (no app chrome) where
 * arriving patients check themselves in: pick their appointment, confirm
 * contact details, sign pending consent forms, done. The front desk sees
 * the arrival instantly in the agenda.
 *
 * Deliberately self-contained with large touch targets and plain language:
 * it runs unattended in the waiting room.
 */

interface KioskAppt {
  id: number;
  start_time: string;
  status: string;
  checked_in_at: string | null;
  patient_id: number;
  first_name: string | null;
  last_name: string | null;
  treatment_name: string | null;
  practitioner_name: string | null;
}

type Step = "select" | "details" | "consents" | "done";

export function KioskPage() {
  const [step, setStep] = useState<Step>("select");
  const [appts, setAppts] = useState<KioskAppt[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<KioskAppt | null>(null);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [pending, setPending] = useState<ConsentTemplate[]>([]);
  const [signIdx, setSignIdx] = useState(0);
  const [signature, setSignature] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const loadToday = async () => {
    try {
      setLoading(true);
      const data = await api<{ appointments: KioskAppt[] }>("GET", "/api/kiosk/today");
      setAppts(data.appointments);
    } catch {
      setAppts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadToday();
    const t = window.setInterval(() => void loadToday(), 60000); // keep the list fresh
    return () => window.clearInterval(t);
  }, []);

  const pick = async (a: KioskAppt) => {
    setSelected(a);
    try {
      const [patient, consents] = await Promise.all([
        api<{ patient: { phone: string | null; email: string | null; address: string | null } }>(
          "GET", `/api/patients/${a.patient_id}`,
        ),
        api<{ templates: ConsentTemplate[] }>("GET", `/api/kiosk/pending-consents/${a.patient_id}`),
      ]);
      setPhone(patient.patient.phone ?? "");
      setEmail(patient.patient.email ?? "");
      setAddress(patient.patient.address ?? "");
      setPending(consents.templates);
      setSignIdx(0);
    } catch {
      setPending([]);
    }
    setStep("details");
  };

  const checkIn = async () => {
    if (!selected) return;
    try {
      await api("POST", "/api/kiosk/check-in", {
        appointment_id: selected.id,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
      });
      if (pending.length) {
        setStep("consents");
      } else {
        setStep("done");
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const signCurrent = async () => {
    if (!selected || !signature) return;
    const t = pending[signIdx];
    try {
      await api("POST", "/api/consent-signatures", {
        template_id: t.id,
        patient_id: selected.patient_id,
        signer_name: [selected.first_name, selected.last_name].filter(Boolean).join(" "),
        signer_role: "patient",
        signature_data: signature,
      });
      if (signIdx + 1 < pending.length) {
        setSignIdx(signIdx + 1);
        setSignature(null);
      } else {
        setStep("done");
      }
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  // ── Signature pad helpers ──
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * canvas.width, y: ((e.clientY - rect.top) / rect.height) * canvas.height };
  };
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawing.current = true;
  };
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(x, y);
    ctx.stroke();
  };
  const endDraw = () => {
    drawing.current = false;
    if (canvasRef.current) setSignature(canvasRef.current.toDataURL("image/png"));
  };
  const clearPad = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    setSignature(null);
  };
  useEffect(() => {
    if (step === "consents" && canvasRef.current) {
      const canvas = canvasRef.current;
      canvas.width = 700;
      canvas.height = 200;
    }
  }, [step, signIdx]);

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Kiosk header */}
      <header className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-600 text-lg font-bold text-white">✚</div>
          <div>
            <h1 className="text-lg font-semibold">Welcome — please check in</h1>
            <p className="text-xs text-muted-foreground">Tap your name below to get started</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadToday()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-8">
        {step === "select" && (
          <div className="space-y-3">
            {loading ? (
              <p className="py-10 text-center text-muted-foreground">Loading today's appointments…</p>
            ) : !appts.length ? (
              <div className="rounded-2xl border border-dashed p-10 text-center">
                <ClipboardCheck className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                <p className="text-lg font-medium">No upcoming appointments right now</p>
                <p className="mt-1 text-sm text-muted-foreground">Please see the front desk and we'll be happy to help.</p>
              </div>
            ) : (
              appts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => void pick(a)}
                  className="flex w-full items-center justify-between rounded-2xl border-2 border-muted bg-card p-5 text-left transition-colors hover:border-teal-500 hover:bg-accent"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-950">
                      <UserRound className="h-6 w-6 text-teal-700 dark:text-teal-300" />
                    </div>
                    <div>
                      <div className="text-lg font-semibold">{[a.first_name, a.last_name].filter(Boolean).join(" ")}</div>
                      <div className="text-sm text-muted-foreground">
                        {time(a.start_time)}{a.treatment_name ? ` · ${a.treatment_name}` : ""}
                        {a.practitioner_name ? ` · ${a.practitioner_name}` : ""}
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-6 w-6 text-muted-foreground" />
                </button>
              ))
            )}
          </div>
        )}

        {step === "details" && selected && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-semibold">Confirm your details</h2>
              <p className="text-sm text-muted-foreground">
                {selected.first_name}, please update anything that has changed, then tap Check in.
              </p>
            </div>
            <div className="space-y-4 rounded-2xl border bg-card p-5">
              <div className="space-y-1.5">
                <Label htmlFor="kiosk-phone">Mobile number</Label>
                <Input id="kiosk-phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" className="h-12 text-lg" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kiosk-email">Email</Label>
                <Input id="kiosk-email" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" className="h-12 text-lg" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="kiosk-address">Address</Label>
                <Input id="kiosk-address" value={address} onChange={(e) => setAddress(e.target.value)} className="h-12 text-lg" />
              </div>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={() => { setStep("select"); setSelected(null); }}>
                Back
              </Button>
              <Button size="lg" className="flex-[2]" onClick={() => void checkIn()}>
                <CheckCircle2 className="mr-2 h-5 w-5" /> Check in
              </Button>
            </div>
          </div>
        )}

        {step === "consents" && selected && pending[signIdx] && (
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Please sign: {pending[signIdx].title}</h2>
              <p className="text-sm text-muted-foreground">Form {signIdx + 1} of {pending.length} · sign with your finger on the line</p>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-2xl border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-wrap">
              {pending[signIdx].body}
            </div>
            <div className="rounded-2xl border-2 border-dashed border-muted-foreground/30 bg-white p-2 dark:bg-slate-50">
              <canvas
                ref={canvasRef}
                className="h-[160px] w-full touch-none rounded"
                onPointerDown={startDraw}
                onPointerMove={moveDraw}
                onPointerUp={endDraw}
                onPointerLeave={endDraw}
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" size="lg" className="flex-1" onClick={clearPad}>Clear</Button>
              <Button size="lg" className="flex-[2]" disabled={!signature} onClick={() => void signCurrent()}>
                Sign {signIdx + 1 < pending.length ? "and continue" : "and finish"}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-10 text-center dark:border-emerald-800 dark:bg-emerald-950/40">
            <CheckCircle2 className={cn("mx-auto mb-4 h-16 w-16 text-emerald-600 dark:text-emerald-400")} />
            <h2 className="text-2xl font-semibold text-emerald-800 dark:text-emerald-200">You're checked in!</h2>
            <p className="mt-2 text-emerald-700 dark:text-emerald-300">
              Please take a seat — we'll call you when we're ready.
            </p>
            <Button variant="outline" size="lg" className="mt-6" onClick={() => { setStep("select"); setSelected(null); setSignature(null); }}>
              Done
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
