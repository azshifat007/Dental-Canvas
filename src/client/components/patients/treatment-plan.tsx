import { useEffect, useMemo, useState } from "react";
import { Info, Plus, ReceiptText, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn, colorClasses, formatMoney } from "@/lib/utils";
import type { Invoice, TreatmentPlanItem, TreatmentPlanStatus } from "@/types";

const STATUSES: TreatmentPlanStatus[] = ["planned", "accepted", "completed", "declined"];
const STATUS_STYLE: Record<TreatmentPlanStatus, string> = {
  planned:   "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  accepted:  "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  completed: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
  declined:  "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
};

export function TreatmentPlan({ patientId }: { patientId: number }) {
  const app = useApp();
  const [items, setItems] = useState<TreatmentPlanItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state for the inline "add row".
  const [treatmentTypeId, setTreatmentTypeId] = useState<string>("none");
  const [tooth, setTooth] = useState("");
  const [fee, setFee] = useState("");
  const [adding, setAdding] = useState(false);
  /** Latest tooth-chart finding for the picked tooth (contextual hint). */
  const [toothFinding, setToothFinding] = useState<string | null>(null);
  /** Item ids already pushed to billing, so the button only shows once. */
  const [billingIds, setBillingIds] = useState<Set<number>>(new Set());
  /** Which item is currently being pushed to billing (spinner on that row). */
  const [billingBusyId, setBillingBusyId] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const data = await api<{ items: TreatmentPlanItem[] }>(
          "GET",
          `/api/patients/${patientId}/treatment-plan`,
        );
        setItems(data.items);
      } catch (err) {
        app.setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [patientId, app]);

  // Default the fee field when picking a treatment type.
  useEffect(() => {
    if (treatmentTypeId === "none") return;
    const tt = app.treatmentTypes.find((t) => t.id === parseInt(treatmentTypeId, 10));
    if (tt && !fee) setFee(String(tt.default_fee));
  }, [treatmentTypeId, app.treatmentTypes, fee]);

  // Auto-fetch the most likely tooth number from the patient's record: the
  // tooth chart's latest finding, then open treatment-plan items, then the
  // chart overall. The dentist can always override it in the field.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [chart, plan] = await Promise.all([
          api<{ conditions: { tooth: string; condition: string; recorded_at: string }[] }>(
            "GET",
            `/api/patients/${patientId}/tooth-chart`,
          ).catch(() => ({ conditions: [] as { tooth: string; condition: string; recorded_at: string }[] })),
          api<{ items: TreatmentPlanItem[] }>("GET", `/api/patients/${patientId}/treatment-plan`),
        ]);
        if (cancelled) return;
        const openPlanTooth = plan.items
          .filter((i) => (i.status === "planned" || i.status === "accepted") && i.tooth)
          .map((i) => i.tooth!)
          .pop();
        const chartTooth = chart.conditions
          .filter((c) => c.condition === "caries" || c.condition === "endo")
          .sort((a, b) => (b.recorded_at ?? "").localeCompare(a.recorded_at ?? ""))[0]?.tooth;
        const suggested = chartTooth ?? openPlanTooth ?? null;
        setTooth((t) => t || suggested || "");
      } catch {
        /* best-effort — the field just stays empty */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  // Look up the tooth-chart finding for the tooth currently typed, so the
  // dentist sees context (“tooth 36: endo”) right in the add row.
  useEffect(() => {
    if (!tooth.trim()) {
      setToothFinding(null);
      return;
    }
    let cancelled = false;
    api<{ conditions: { tooth: string; condition: string }[] }>(
      "GET",
      `/api/patients/${patientId}/tooth-chart`,
    )
      .then((res) => {
        if (cancelled) return;
        const hit = res.conditions.find((c) => c.tooth === tooth.trim());
        setToothFinding(hit?.condition ?? null);
      })
      .catch(() => {
        if (!cancelled) setToothFinding(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tooth, patientId]);

  // When the picked treatment is a root-canal code, surface the multi-visit hint.
  const isEndoPick = useMemo(() => {
    if (treatmentTypeId === "none") return false;
    const tt = app.treatmentTypes.find((t) => t.id === parseInt(treatmentTypeId, 10));
    if (!tt) return false;
    const hay = `${tt.code} ${tt.name}`.toLowerCase();
    return hay.includes("rct") || hay.includes("root canal") || hay.includes("endo");
  }, [treatmentTypeId, app.treatmentTypes]);

  const totals = useMemo(() => {
    const sum = (s: TreatmentPlanStatus) =>
      items.filter((i) => i.status === s).reduce((acc, i) => acc + i.fee, 0);
    return {
      planned: sum("planned"),
      accepted: sum("accepted"),
      completed: sum("completed"),
    };
  }, [items]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const tt = treatmentTypeId === "none" ? null : parseInt(treatmentTypeId, 10);
      const f = parseFloat(fee || "0") || 0;
      const res = await api<{ item: TreatmentPlanItem }>("POST", "/api/treatment-plan-items", {
        patient_id: patientId,
        treatment_type_id: tt,
        tooth: tooth.trim() || null,
        fee: f,
      });
      setItems((prev) => [...prev, res.item]);
      setTooth("");
      setFee("");
      setTreatmentTypeId("none");
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  /**
   * Root canal on a tooth spans at least two sittings, and repeat patients
   * come back for each — add the whole series at once (each visit its own
   * row, so every sitting can be accepted, completed and billed separately).
   */
  async function addRctSeries() {
    if (treatmentTypeId === "none") return;
    setAdding(true);
    try {
      const tt = parseInt(treatmentTypeId, 10);
      const total = parseFloat(fee || "0") || 0;
      const perVisit = Math.round((total / 2) * 100) / 100;
      const created: TreatmentPlanItem[] = [];
      for (const visit of ["Visit 1 — access & cleaning", "Visit 2 — filling & crown"] as const) {
        const res = await api<{ item: TreatmentPlanItem }>("POST", "/api/treatment-plan-items", {
          patient_id: patientId,
          treatment_type_id: tt,
          tooth: tooth.trim() || null,
          fee: perVisit,
          notes: visit,
        });
        created.push(res.item);
      }
      setItems((prev) => [...prev, ...created]);
      setTooth("");
      setFee("");
      setTreatmentTypeId("none");
      toast.success("2-visit root canal series added");
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function setStatus(id: number, status: TreatmentPlanStatus) {
    try {
      const res = await api<{ item: TreatmentPlanItem }>("PUT", `/api/treatment-plan-items/${id}`, { status });
      setItems((prev) => prev.map((i) => (i.id === id ? res.item : i)));
      // Accepted or completed work flows straight to the patient's billing —
      // one less manual invoice to type at the front desk.
      if ((status === "accepted" || status === "completed") && res.item.fee > 0) {
        const created = await addPlanItemToBilling(res.item);
        if (created) {
          setBillingIds((prev) => new Set(prev).add(id));
          toast.success(`Added to billing — invoice #${created.id}`);
        }
      }
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  /** Add one item to an invoice and return the updated invoice (or null). */
  async function addPlanItemToBilling(item: TreatmentPlanItem) {
    setBillingBusyId(item.id);
    try {
      const res = await api<{ invoice: Invoice }>("POST", `/api/treatment-plan-items/${item.id}/invoice`, {});
      return res.invoice;
    } catch (err) {
      toast.error((err as Error).message);
      return null;
    } finally {
      setBillingBusyId(null);
    }
  }

  async function billNow(item: TreatmentPlanItem) {
    const created = await addPlanItemToBilling(item);
    if (created) {
      setBillingIds((prev) => new Set(prev).add(item.id));
      toast.success(`Added to billing — invoice #${created.id}`);
    }
  }

  async function remove(id: number) {
    if (!confirm("Remove this plan item?")) return;
    try {
      await api("DELETE", `/api/treatment-plan-items/${id}`);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="Planned"   amount={totals.planned}   tone="sky" />
        <SummaryCard label="Accepted"  amount={totals.accepted}  tone="emerald" />
        <SummaryCard label="Completed" amount={totals.completed} tone="slate" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Treatment plan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={addItem} className="grid grid-cols-1 items-end gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs">Treatment</Label>
              <Select value={treatmentTypeId} onValueChange={setTreatmentTypeId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— None —</SelectItem>
                  {app.treatmentTypes.map((t) => (
                    <SelectItem key={t.id} value={t.id.toString()}>{t.code} · {t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isEndoPick && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Info className="h-3 w-3 shrink-0" />
                    Root canal usually needs a revisit — add each sitting as its own row.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={adding}
                    onClick={addRctSeries}
                  >
                    <Plus className="h-3 w-3" /> Add 2-visit series
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Tooth</Label>
              <Input value={tooth} onChange={(e) => setTooth(e.target.value)} placeholder="e.g. 14" />
              {toothFinding && (
                <p className="text-[11px] capitalize text-muted-foreground">Chart: {toothFinding}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fee</Label>
              <Input type="number" step="0.01" min="0" value={fee} onChange={(e) => setFee(e.target.value)} placeholder="0.00" />
            </div>
            <Button type="submit" disabled={adding}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </form>

          {loading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No plan items yet.</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Treatment</th>
                    <th className="px-3 py-2 font-semibold">Tooth</th>
                    <th className="px-3 py-2 text-right font-semibold">Fee</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((i) => {
                    const palette = colorClasses(i.treatment_color || "sky");
                    return (
                      <tr key={i.id} className="border-b last:border-0">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className={cn("inline-block h-2 w-2 rounded-full", palette.dot)} />
                            <span className="font-medium">
                              {i.treatment_name ?? "—"}
                            </span>
                            {i.treatment_code && (
                              <Badge variant="outline" className="text-[10px]">{i.treatment_code}</Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2">{i.tooth ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(i.fee)}</td>
                        <td className="px-3 py-2">
                          <Select value={i.status} onValueChange={(v) => setStatus(i.id, v as TreatmentPlanStatus)}>
                            <SelectTrigger className={cn("h-7 w-[140px] text-xs", STATUS_STYLE[i.status])}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUSES.map((s) => (
                                <SelectItem key={s} value={s}>{capitalize(s)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            {(i.status === "accepted" || i.status === "completed") && i.fee > 0 && !billingIds.has(i.id) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 gap-1 px-2 text-xs"
                                disabled={billingBusyId === i.id}
                                onClick={() => billNow(i)}
                                title="Add this treatment to the patient's billing (invoice)"
                              >
                                {billingBusyId === i.id ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ReceiptText className="h-3.5 w-3.5" />}
                                Bill
                              </Button>
                            )}
                            {billingIds.has(i.id) && (
                              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                                In billing
                              </Badge>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => remove(i.id)} aria-label="Delete">
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, amount, tone }: { label: string; amount: number; tone: "sky" | "emerald" | "slate" }) {
  const palette = colorClasses(tone);
  return (
    <div className={cn("rounded-lg border p-4", palette.bg, palette.border)}>
      <div className={cn("text-xs font-semibold uppercase tracking-wider", palette.text, "opacity-80")}>{label}</div>
      <div className={cn("mt-1 text-2xl font-bold tabular-nums", palette.text)}>{formatMoney(amount)}</div>
    </div>
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
