import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Copy, Link2, Loader2, Pause, Play, QrCode, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { openExternalUrl } from "@/lib/open-external";
import type { Practitioner, TreatmentType } from "@/types";

/**
 * Settings → Online booking: issue and manage the public booking links
 * patients use at /book/<token>. Practice-wide or per-practitioner, with an
 * optional treatment preset and a bookable window.
 */

interface BookingLink {
  id: number;
  token: string;
  label: string;
  practitioner_id: number | null;
  practitioner_name: string | null;
  treatment_type_id: number | null;
  treatment_name: string | null;
  days_ahead: number;
  active: number;
  created_at: string;
}

export function BookingTab() {
  const app = useApp();
  const [links, setLinks] = useState<BookingLink[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [label, setLabel] = useState("Online booking");
  const [practitionerId, setPractitionerId] = useState<string>("any");
  const [treatmentId, setTreatmentId] = useState<string>("any");
  const [daysAhead, setDaysAhead] = useState("14");

  const reload = useCallback(async () => {
    try {
      const res = await api<{ links: BookingLink[] }>("GET", "/api/booking/links");
      setLinks(res.links);
    } catch (err) {
      app.setError((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create() {
    setBusy("create");
    try {
      await api("POST", "/api/booking/links", {
        label: label.trim() || "Online booking",
        practitioner_id: practitionerId === "any" ? null : Number(practitionerId),
        treatment_type_id: treatmentId === "any" ? null : Number(treatmentId),
        days_ahead: Number(daysAhead) || 14,
      });
      toast.success("Booking link created");
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function toggle(link: BookingLink) {
    setBusy(`t-${link.id}`);
    try {
      await api("PUT", `/api/booking/links/${link.id}`, { active: !link.active });
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove(link: BookingLink) {
    if (!confirm(`Delete the "${link.label}" link? Patients holding it will see "not available".`)) return;
    setBusy(`d-${link.id}`);
    try {
      await api("DELETE", `/api/booking/links/${link.id}`);
      toast.success("Link deleted");
      await reload();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function bookingUrl(token: string): string {
    return `${window.location.origin}/book/${token}`;
  }

  async function copy(link: BookingLink) {
    try {
      await navigator.clipboard.writeText(bookingUrl(link.token));
      toast.success("Link copied — share it on your website, Google profile, or WhatsApp");
    } catch {
      // Clipboard can be blocked (WebView2 permission, window not focused);
      // point at the working manual route instead of a silent failure.
      toast.error("Copy failed — use Preview and copy the link from the browser", 8000);
    }
  }

  const practitioners = app.practitioners as Practitioner[];
  const treatments = app.treatmentTypes as TreatmentType[];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Online booking links
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Share a link and patients book themselves into real free slots on
            your agenda — new patients are registered automatically. Nothing
            else on your data is reachable through a link.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Create form */}
          <div className="grid items-end gap-3 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1.5 lg:col-span-2">
              <Label htmlFor="bk-label">Label</Label>
              <Input id="bk-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Website / Facebook / WhatsApp" />
            </div>
            <div className="space-y-1.5">
              <Label>Practitioner</Label>
              <Select value={practitionerId} onValueChange={setPractitionerId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  {practitioners.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Treatment menu</Label>
              <Select value={treatmentId} onValueChange={setTreatmentId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">All treatments</SelectItem>
                  {treatments.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bk-days">Book up to (days)</Label>
              <div className="flex gap-2">
                <Input id="bk-days" type="number" min={1} max={60} value={daysAhead} onChange={(e) => setDaysAhead(e.target.value)} />
                <Button onClick={create} disabled={busy !== null} className="shrink-0">
                  {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
                  Create
                </Button>
              </div>
            </div>
          </div>

          {/* Links list */}
          {!links ? (
            <p className="py-4 text-sm text-muted-foreground">Loading…</p>
          ) : links.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No links yet — create one above and share it with patients.
            </p>
          ) : (
            <div className="space-y-2">
              {links.map((link) => (
                <div key={link.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                  <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${link.active ? "bg-emerald-500" : "bg-muted-foreground/40"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {link.label}
                      {link.practitioner_name && <span className="font-normal text-muted-foreground"> · {link.practitioner_name}</span>}
                      {link.treatment_name && <span className="font-normal text-muted-foreground"> · {link.treatment_name}</span>}
                      <span className="font-normal text-muted-foreground"> · {link.days_ahead}d window</span>
                    </p>
                    <code className="block truncate text-xs text-muted-foreground">{bookingUrl(link.token)}</code>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => copy(link)}>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void openExternalUrl(bookingUrl(link.token))} title="Preview the patient view in your browser">
                      <QrCode className="h-3.5 w-3.5" /> Preview
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggle(link)} disabled={busy !== null}>
                      {busy === `t-${link.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : link.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      {link.active ? "Pause" : "Enable"}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(link)} disabled={busy !== null}>
                      {busy === `d-${link.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
