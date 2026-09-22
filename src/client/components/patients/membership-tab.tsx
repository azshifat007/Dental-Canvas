import { useEffect, useState } from "react";
import { BadgePercent, CalendarClock, CreditCard, Plus, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn, formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/toast";
import type { MembershipPlan, PatientMembership } from "@/types";

/**
 * Membership tab in the patient profile: shows the patient's in-house plan
 * (the clinic's own discount membership, not insurance), lets the front desk
 * enroll them in one click, and cancels memberships they no longer hold.
 */
export function MembershipTab({ patientId }: { patientId: number }) {
  const app = useApp();
  const [memberships, setMemberships] = useState<PatientMembership[]>([]);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [planId, setPlanId] = useState<string>("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));

  const load = async () => {
    try {
      setLoading(true);
      const [m, p] = await Promise.all([
        api<{ memberships: PatientMembership[] }>("GET", `/api/patients/${patientId}/membership`),
        api<{ plans: MembershipPlan[] }>("GET", "/api/membership-plans"),
      ]);
      setMemberships(m.memberships);
      setPlans(p.plans.filter((pl) => pl.active));
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId]);

  const enroll = async () => {
    if (!planId) return;
    try {
      await api("POST", "/api/patient-memberships", {
        patient_id: patientId,
        plan_id: Number(planId),
        start_date: startDate,
      });
      toast.success("Patient enrolled in membership");
      setEnrolling(false);
      setPlanId("");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const cancel = async (m: PatientMembership) => {
    if (!confirm(`Remove ${m.plan_name ?? "this membership"}? This cannot be undone.`)) return;
    try {
      await api("DELETE", `/api/patient-memberships/${m.id}`);
      toast.info("Membership removed");
      await load();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const active = memberships.find((m) => m.status === "active");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            Membership
          </CardTitle>
          <Button size="sm" onClick={() => setEnrolling(true)} disabled={!plans.length}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {active ? "Change plan" : "Enroll in plan"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !memberships.length ? (
            <p className="text-sm text-muted-foreground">
              No membership. {plans.length ? "Enroll the patient in an in-house plan to give them a standing discount." : "Create plans in Settings → Membership first."}
            </p>
          ) : (
            memberships.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-lg border p-3",
                  m.status === "active" && "border-teal-300 bg-teal-50/50 dark:border-teal-800 dark:bg-teal-950/30",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{m.plan_name}</span>
                    <Badge variant={m.status === "active" ? "default" : "secondary"} className="text-[10px] uppercase">
                      {m.status}
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <BadgePercent className="h-3 w-3" />
                      {m.discount_percent}% off all treatment
                    </span>
                    {m.monthly_fee != null && m.monthly_fee > 0 && (
                      <span>${m.monthly_fee}/month</span>
                    )}
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />
                      since {formatDate(m.start_date)}
                    </span>
                  </div>
                  {m.benefits && <p className="text-xs text-muted-foreground">{m.benefits}</p>}
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => cancel(m)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={enrolling} onOpenChange={setEnrolling}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Enroll in membership plan</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Plan</Label>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger><SelectValue placeholder="Choose a plan" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name} — ${p.monthly_fee}/mo, {p.discount_percent}% off
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            {(() => {
              const p = plans.find((pl) => String(pl.id) === planId);
              return p?.benefits ? <p className="text-xs text-muted-foreground">{p.benefits}</p> : null;
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEnrolling(false)}>Cancel</Button>
            <Button onClick={enroll} disabled={!planId}>Enroll</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
