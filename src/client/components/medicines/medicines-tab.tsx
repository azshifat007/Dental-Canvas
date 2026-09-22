import { useMemo, useState } from "react";
import { Pencil, Plus, Pill, Search, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { toast } from "@/components/ui/toast";
import type { Medicine } from "@/types";
import type { DrugGroup } from "@/lib/dental-drugs";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

const GROUPS: DrugGroup[] = ["Antibiotic", "Analgesic", "Antifungal", "Antiviral", "Antiseptic rinse", "Other"];

const GROUP_STYLE: Record<DrugGroup, string> = {
  Antibiotic: "bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
  Analgesic: "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  Antifungal: "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800",
  Antiviral: "bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  "Antiseptic rinse": "bg-teal-100 text-teal-800 border-teal-200 dark:bg-teal-950 dark:text-teal-200 dark:border-teal-800",
  Other: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700",
};

interface Draft {
  name: string;
  drug_group: DrugGroup;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

const EMPTY_DRAFT: Draft = { name: "", drug_group: "Other", dosage: "", frequency: "", duration: "", instructions: "" };

/**
 * The practice's editable medicine list (Medicines). Additions and edits feed
 * the prescription editor's drug autocomplete, and the list survives redeploys
 * (it lives in the database, seeded only when empty).
 */
export function MedicinesTab() {
  const app = useApp();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return app.medicines;
    return app.medicines.filter((m) =>
      [m.name, m.drug_group, m.dosage, m.frequency, m.instructions].some((f) => (f ?? "").toLowerCase().includes(q)),
    );
  }, [app.medicines, query]);

  function openAdd() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setDialogOpen(true);
  }

  function openEdit(m: Medicine) {
    setEditingId(m.id);
    setDraft({
      name: m.name,
      drug_group: (m.drug_group as DrugGroup) || "Other",
      dosage: m.dosage ?? "",
      frequency: m.frequency ?? "",
      duration: m.duration ?? "",
      instructions: m.instructions ?? "",
    });
    setDialogOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setBusy(true);
    try {
      const body = {
        name: draft.name.trim(),
        drug_group: draft.drug_group,
        dosage: draft.dosage.trim() || undefined,
        frequency: draft.frequency.trim() || undefined,
        duration: draft.duration.trim() || undefined,
        instructions: draft.instructions.trim() || undefined,
      };
      if (editingId) {
        await api("PUT", `/api/medicines/${editingId}`, body);
        toast.success(`${body.name} updated`);
      } else {
        await api("POST", "/api/medicines", body);
        toast.success(`${body.name} added to your medicine list`);
      }
      await app.refreshMedicines();
      setDialogOpen(false);
    } catch (err) {
      toast.error((err as Error).message);
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: Medicine) {
    if (!confirm(`Remove “${m.name}” from the medicine list? Prescriptions already issued keep their text.`)) return;
    try {
      await api("DELETE", `/api/medicines/${m.id}`);
      await app.refreshMedicines();
      toast.success(`${m.name} removed`);
    } catch (err) {
      toast.error((err as Error).message);
      app.setError((err as Error).message);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search medicines…" className="pl-8" />
        </div>
        <span className="text-sm text-muted-foreground">
          {app.medicines.length} medicine{app.medicines.length === 1 ? "" : "s"}
        </span>
        <Button size="sm" className="ml-auto" onClick={openAdd}>
          <Plus className="h-4 w-4" /> Add medicine
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        This list feeds the medicine suggestions when writing a prescription. Presets include a standard adult
        regimen that fills the prescription row when picked — everything stays editable there.
      </p>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-muted-foreground">
              <Pill className="h-6 w-6" />
              {app.medicines.length === 0
                ? "No medicines yet — add the drugs your practice prescribes most."
                : "No medicines match that search."}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((m) => {
                const group = (m.drug_group as DrugGroup) || "Other";
                return (
                  <li key={m.id} className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/40">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.name}</span>
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${GROUP_STYLE[group] ?? GROUP_STYLE.Other}`}>
                          {group}
                        </span>
                      </div>
                      {(m.dosage || m.frequency || m.duration) && (
                        <div className="mt-0.5 text-sm text-muted-foreground">
                          {[m.dosage, m.frequency, m.duration ? `for ${m.duration}` : null].filter(Boolean).join(" · ")}
                        </div>
                      )}
                      {m.instructions && <div className="mt-0.5 text-xs text-muted-foreground">{m.instructions}</div>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 pt-0.5">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(m)} aria-label={`Edit ${m.name}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => remove(m)}
                        aria-label={`Remove ${m.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit medicine" : "Add medicine"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Name *</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="e.g. Amoxicillin 500mg caps"
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Group</Label>
              <Select value={draft.drug_group} onValueChange={(v) => setDraft({ ...draft, drug_group: v as DrugGroup })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Dosage</Label>
                <Input value={draft.dosage} onChange={(e) => setDraft({ ...draft, dosage: e.target.value })} placeholder="500 mg" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Frequency</Label>
                <Input value={draft.frequency} onChange={(e) => setDraft({ ...draft, frequency: e.target.value })} placeholder="3x daily" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Duration</Label>
                <Input value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value })} placeholder="5 days" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Instructions</Label>
              <Textarea
                rows={2}
                value={draft.instructions}
                onChange={(e) => setDraft({ ...draft, instructions: e.target.value })}
                placeholder="e.g. after meals; avoid alcohol"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !draft.name.trim()}>
                {busy ? "Saving…" : editingId ? "Save changes" : "Add to list"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
