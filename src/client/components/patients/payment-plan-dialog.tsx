import { useEffect, useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import { api } from "@/api";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatDate } from "@/lib/utils";

const money = (n: number): string => n.toLocaleString(undefined, { style: "currency", currency: "USD" });
import type { Invoice } from "@/types";

/**
 * Payment plans: split an invoice's outstanding balance into weekly or
 * monthly installments. The schedule is informational (it guides the front
 * desk's collection calls); actual payments still flow through the normal
 * payment ledger, so any amount can be received at any time.
 */

interface PlanRow {
  id: number;
  installment_count: number;
  interval: "weekly" | "monthly";
  start_date: string;
  installment_amount: number;
  active: number | boolean;
}

interface ScheduleRow {
  n: number;
  due_date: string;
  amount: number;
}

export function PaymentPlanDialog({
  invoice,
  onClose,
  onChanged,
}: {
  invoice: Invoice;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const balance = invoice.balance ?? invoice.total - invoice.amount_paid;
  const [count, setCount] = useState("3");
  const [interval, setInterval] = useState<"weekly" | "monthly">("monthly");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const res = await api<{ plan: PlanRow | null; schedule: ScheduleRow[] }>(
        "GET", `/api/invoices/${invoice.id}/payment-plan`,
      );
      setPlan(res.plan);
      setSchedule(res.schedule ?? []);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  const create = async () => {
    try {
      setSaving(true);
      await api("POST", `/api/invoices/${invoice.id}/payment-plan`, {
        installment_count: Number(count),
        interval,
        start_date: startDate,
      });
      toast.success(`Payment plan created — ${count} ${interval} installments`);
      await load();
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm("Remove the payment plan? Payments already recorded stay attached to the invoice.")) return;
    try {
      await api("DELETE", `/api/invoices/${invoice.id}/payment-plan`);
      toast.info("Payment plan removed");
      setPlan(null);
      setSchedule([]);
      await onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const previewAmount = Math.floor((balance / Number(count || "1")) * 100) / 100;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Payment plan — invoice #{invoice.id}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <p className="text-sm text-muted-foreground">
            Outstanding balance <span className="font-semibold text-foreground">{money(balance)}</span>. Split it into
            equal installments; record each received installment as a normal payment.
          </p>

          {!plan && (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Installments</Label>
                <Select value={count} onValueChange={setCount}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[2, 3, 4, 6, 8, 12].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Every</Label>
                <Select value={interval} onValueChange={(v) => setInterval(v as "weekly" | "monthly")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Week</SelectItem>
                    <SelectItem value="monthly">Month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>First due</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
            </div>
          )}

          {plan ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <span>
                  {plan.installment_count} × {money(plan.installment_amount)} ({plan.interval})
                </span>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => void remove()}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove plan
                </Button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-lg border">
                <table className="w-full text-sm">
                  <tbody>
                    {schedule.map((s) => (
                      <tr key={s.n} className="border-b last:border-0">
                        <td className="px-3 py-1.5 text-xs text-muted-foreground">#{s.n}</td>
                        <td className="px-3 py-1.5">{formatDate(s.due_date)}</td>
                        <td className={cn("px-3 py-1.5 text-right tabular-nums font-medium")}>{money(s.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed px-3 py-2 text-sm">
              {count && Number(count) >= 2 ? (
                <>≈ <span className="font-semibold">{money(previewAmount)}</span> per {interval === "weekly" ? "week" : "month"} starting {formatDate(startDate)}</>
              ) : (
                "Choose the number of installments"
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {!plan && (
            <Button onClick={() => void create()} disabled={saving || !count || Number(count) < 2}>
              {saving ? "Creating…" : "Create plan"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
