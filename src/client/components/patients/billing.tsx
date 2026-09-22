import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarClock, Plus, Printer, Receipt, Trash2, X } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { toast } from "@/components/ui/toast";
import type { Invoice, InvoiceItem, InvoicePayment, PaymentMethod, TreatmentType } from "@/types";
import { PaymentPlanDialog } from "./payment-plan-dialog";
import { cn, formatDate, formatTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Billing tab: line-item invoices (no more bare "quick total"), a partial
 * payment ledger, and a printable receipt per invoice. The patient's balance
 * is derived from the invoice rows.
 */

const STATUS_STYLE: Record<Invoice["status"], string> = {
  open: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  paid: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  void: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
};

const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  transfer: "Transfer",
  insurance: "Insurance",
  other: "Other",
};

function money(n: number): string {
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function Billing({
  patientId,
  navigate,
}: {
  patientId: number;
  navigate: (to: string) => void;
}) {
  const app = useApp();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsFor, setItemsFor] = useState<Invoice | null>(null); // line-item editor
  const [payFor, setPayFor] = useState<Invoice | null>(null); // payment dialog
  const [planFor, setPlanFor] = useState<Invoice | null>(null); // installment plan dialog

  const reload = async () => {
    try {
      const data = await api<{ invoices: Invoice[] }>("GET", `/api/patients/${patientId}/invoices`);
      setInvoices(data.invoices);
    } catch (err) {
      app.setError((err as Error).message);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await reload();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const summary = useMemo(() => {
    let billed = 0;
    let paid = 0;
    for (const i of invoices) {
      if (i.status === "void") continue;
      billed += i.total;
      paid += i.amount_paid;
    }
    return { billed, paid, balance: billed - paid };
  }, [invoices]);

  async function addQuickInvoice(e: React.FormEvent) {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const desc = String(form.get("description") ?? "").trim();
    const qty = Number(form.get("quantity") ?? 1) || 1;
    const price = Number(form.get("unit_price") ?? 0);
    if (!desc || price <= 0) {
      app.setError("Enter a description and a price greater than 0.");
      return;
    }
    try {
      // Create an empty invoice, then set its items (which recomputes total).
      const created = await api<{ invoice: Invoice }>("POST", "/api/invoices", { patient_id: patientId });
      await api("PUT", `/api/invoices/${created.invoice.id}/items`, {
        items: [{ description: desc, quantity: qty, unit_price: price }],
      });
      setItemsDesc("");
      setItemsQty("1");
      setItemsPrice("");
      toast.success(`Invoice #${created.invoice.id} created`);
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
      app.setError((err as Error).message);
    }
  }

  const [itemsDesc, setItemsDesc] = useState("");
  const [itemsQty, setItemsQty] = useState("1");
  const [itemsPrice, setItemsPrice] = useState("");

  async function remove(id: number) {
    if (!confirm("Delete this invoice?")) return;
    try {
      await api("DELETE", `/api/invoices/${id}`);
      setInvoices((prev) => prev.filter((i) => i.id !== id));
      toast.success(`Invoice #${id} deleted`);
    } catch (err) {
      toast.error((err as Error).message);
      app.setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryStat label="Billed" amount={summary.billed} tone="sky" />
        <SummaryStat label="Paid" amount={summary.paid} tone="emerald" />
        <SummaryStat label="Outstanding" amount={summary.balance} tone={summary.balance > 0 ? "rose" : "slate"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <form onSubmit={addQuickInvoice} className="grid items-end gap-2 rounded-md border bg-muted/30 p-3 sm:grid-cols-[2fr_0.6fr_1fr_auto]">
            <div className="space-y-1.5">
              <Label className="text-xs">First line item</Label>
              <Input value={itemsDesc} onChange={(e) => setItemsDesc(e.target.value)} placeholder="e.g. Composite filling, tooth 26" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Qty</Label>
              <Input type="number" min="1" value={itemsQty} onChange={(e) => setItemsQty(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unit price</Label>
              <Input type="number" step="0.01" min="0" value={itemsPrice} onChange={(e) => setItemsPrice(e.target.value)} placeholder="0.00" />
            </div>
            <Button type="submit">
              <Plus className="h-4 w-4" /> Invoice
            </Button>
          </form>

          {loading ? (
            <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">Loading…</div>
          ) : invoices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No invoices yet.</p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 text-right font-semibold">Total</th>
                    <th className="px-3 py-2 text-right font-semibold">Paid</th>
                    <th className="px-3 py-2 text-right font-semibold">Balance</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-mono text-xs">{inv.id}</td>
                      <td className="px-3 py-2">{formatDate(inv.issued_at)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(inv.total)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{money(inv.amount_paid)}</td>
                      <td className={cn("px-3 py-2 text-right tabular-nums", (inv.balance ?? inv.total - inv.amount_paid) > 0 && inv.status !== "void" ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
                        {inv.status === "void" ? "—" : money(inv.balance ?? inv.total - inv.amount_paid)}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="outline" className={STATUS_STYLE[inv.status]}>
                          {inv.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          {inv.status !== "void" && (inv.balance ?? inv.total - inv.amount_paid) > 0 && (
                            <>
                              <Button size="sm" variant="outline" onClick={() => setPayFor(inv)}>
                                <Banknote className="h-4 w-4" /> Pay
                              </Button>
                              <Button size="icon" variant="ghost" title="Payment plan (installments)" onClick={() => setPlanFor(inv)}>
                                <CalendarClock className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          <Button size="icon" variant="ghost" title="Edit line items" onClick={() => setItemsFor(inv)}>
                            <Receipt className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Print receipt"
                            onClick={() => navigate(`/patients/${patientId}/invoices/${inv.id}`)}
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" className="text-muted-foreground" onClick={() => remove(inv.id)} title="Delete">
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
        </CardContent>
      </Card>

      {itemsFor && (
        <ItemsDialog
          invoice={itemsFor}
          onClose={() => setItemsFor(null)}
          onSaved={async () => {
            setItemsFor(null);
            await reload();
          }}
        />
      )}
      {payFor && (
        <PaymentDialog
          invoice={payFor}
          onClose={() => setPayFor(null)}
          onSaved={async () => {
            setPayFor(null);
            await reload();
          }}
        />
      )}
      {planFor && (
        <PaymentPlanDialog
          invoice={planFor}
          onClose={() => setPlanFor(null)}
          onChanged={async () => {
            await reload();
          }}
        />
      )}
    </div>
  );
}

function SummaryStat({ label, amount, tone }: { label: string; amount: number; tone: "sky" | "emerald" | "rose" | "slate" }) {
  const tones = {
    sky: "text-sky-700 dark:text-sky-300",
    emerald: "text-emerald-700 dark:text-emerald-300",
    rose: "text-rose-700 dark:text-rose-300",
    slate: "text-muted-foreground",
  } as const;
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("mt-1 text-xl font-bold tabular-nums", tones[tone])}>{money(amount)}</div>
    </div>
  );
}

// ── Line-item editor ───────────────────────────────────────────────

function ItemsDialog({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSaved: () => void;
}) {
  const app = useApp();
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ items: InvoiceItem[] }>("GET", `/api/invoices/${invoice.id}`);
        setItems(
          res.items.length > 0
            ? res.items
            : [{ description: "", quantity: 1, unit_price: invoice.total || 0 }],
        );
      } catch (err) {
        app.setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoice.id]);

  const total = items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0);

  function patch(index: number, p: Partial<InvoiceItem>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...p } : it)));
  }

  async function save() {
    const valid = items.filter((i) => i.description.trim() && i.unit_price > 0);
    if (valid.length === 0) {
      app.setError("Add at least one line item with a description and price.");
      return;
    }
    setSaving(true);
    try {
      await api("PUT", `/api/invoices/${invoice.id}/items`, {
        items: valid.map((i) => ({
          description: i.description.trim(),
          quantity: i.quantity || 1,
          unit_price: i.unit_price,
          treatment_type_id: i.treatment_type_id ?? null,
        })),
      });
      onSaved();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Invoice #{invoice.id} — line items</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="grid items-center gap-2 rounded-md border bg-muted/30 p-2 sm:grid-cols-[2fr_0.6fr_1fr_auto]">
                  <Input value={item.description} onChange={(e) => patch(i, { description: e.target.value })} placeholder="Description" className="h-9" />
                  <Input
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(e) => patch(i, { quantity: Number(e.target.value) || 1 })}
                    className="h-9"
                    aria-label="Quantity"
                  />
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.unit_price}
                    onChange={(e) => patch(i, { unit_price: Number(e.target.value) || 0 })}
                    className="h-9"
                    aria-label="Unit price"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 text-muted-foreground"
                    onClick={() => setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, j) => j !== i)))}
                    title="Remove line"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, { description: "", quantity: 1, unit_price: 0 }])}>
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
            <div className="flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">
                Previous total {money(invoice.total)} — payments stay attached
              </span>
              <span className="text-base font-bold tabular-nums">New total {money(total)}</span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save items"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Payment dialog ─────────────────────────────────────────────────

function PaymentDialog({
  invoice,
  onClose,
  onSaved,
}: {
  invoice: Invoice;
  onClose: () => void;
  onSaved: () => void;
}) {
  const app = useApp();
  const balance = invoice.balance ?? invoice.total - invoice.amount_paid;
  const [amount, setAmount] = useState(balance.toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>("card");
  const [payments, setPayments] = useState<InvoicePayment[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await api<{ payments: InvoicePayment[] }>("GET", `/api/invoices/${invoice.id}`);
        setPayments(res.payments);
      } catch {
        /* non-fatal */
      }
    })();
  }, [invoice.id]);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      app.setError("Enter a payment amount greater than 0.");
      return;
    }
    setBusy(true);
    try {
      await api("POST", `/api/invoices/${invoice.id}/payments`, { amount: amt, method });
      toast.success(`Payment of ${amt.toLocaleString(undefined, { style: "currency", currency: "USD" })} recorded`);
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removePayment(id: number) {
    setBusy(true);
    try {
      await api("DELETE", `/api/invoices/${invoice.id}/payments/${id}`);
      const res = await api<{ payments: InvoicePayment[] }>("GET", `/api/invoices/${invoice.id}`);
      setPayments(res.payments);
      const inv = await api<{ invoice: Invoice }>("GET", `/api/invoices/${invoice.id}`);
      // Refresh the parent list via onSaved on close; meanwhile patch locally.
      setAmount(Math.max(0, inv.invoice.total - inv.invoice.amount_paid).toFixed(2));
      app.refreshLookups?.();
      void inv;
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Payment — invoice #{invoice.id}</DialogTitle>
        </DialogHeader>
        <div className="mb-2 flex justify-between text-sm">
          <span className="text-muted-foreground">Outstanding</span>
          <span className="font-bold tabular-nums text-rose-600 dark:text-rose-400">{money(balance)}</span>
        </div>
        <form onSubmit={pay} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount</Label>
              <Input type="number" step="0.01" min="0.01" max={balance} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(METHOD_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {payments.length > 0 && (
            <div className="rounded-md border">
              <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Payment history
              </div>
              <ul className="divide-y">
                {payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="tabular-nums">{money(p.amount)}</span>
                    <span className="text-xs text-muted-foreground">
                      {METHOD_LABELS[p.method] ?? p.method} · {formatDate(p.paid_at)} {formatTime(p.paid_at)}
                    </span>
                    <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removePayment(p.id)} title="Remove payment">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Done
            </Button>
            <Button type="submit" disabled={busy}>
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
