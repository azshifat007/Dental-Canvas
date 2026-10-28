import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, UserPlus } from "lucide-react";
import { useApp } from "@/context";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";
import type { Patient } from "@/types";
import { PatientDialog } from "./patient-dialog";

export function PatientsList({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [balances, setBalances] = useState<Record<string, number>>({});
  /** Patient being quick-edited from its row; null = registering a new one. */
  const [editing, setEditing] = useState<Patient | null>(null);

  // Debounced search
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setLoading(true);
        const [pRes, bRes] = await Promise.all([
          api<{ patients: Patient[] }>(
            "GET",
            q.trim() ? `/api/patients?q=${encodeURIComponent(q.trim())}` : "/api/patients",
          ),
          // Balances come from the reports endpoint (open-invoice sums per patient).
          api<{ balances: Record<string, number> }>("GET", "/api/reports/balances").catch(() => ({ balances: {} })),
        ]);
        if (!cancelled) {
          setPatients(pRes.patients);
          setBalances(bRes.balances ?? {});
        }
      } catch (err) {
        if (!cancelled) app.setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, app]);

  const visible = useMemo(() => patients, [patients]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Patients</h1>
        <div className="relative ml-auto w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name, email, phone…"
            className="pl-9"
          />
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
          size="sm"
        >
          <Plus className="h-4 w-4" />
          New patient
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              {/* Email is the one column that can be dropped on a phone
                  without losing what the list is for: with it visible the
                  table scrolled sideways and every row wrapped to three
                  lines. It stays available on the patient's record. */}
              <TableRow>
                {/* Name claims the leftover width so "Villanueva, Marta"
                    stays on one line on a phone. */}
                <TableHead className="w-full px-2 sm:px-3">Name</TableHead>
                <TableHead className="hidden px-2 sm:table-cell sm:px-3">DOB</TableHead>
                <TableHead className="hidden sm:table-cell">Email</TableHead>
                <TableHead className="px-2 sm:px-3">Phone</TableHead>
                <TableHead className="px-2 sm:px-3">Alerts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} aria-hidden className="py-6">
                    {/* Skeleton rows, matching the list's real rhythm. */}
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-4 py-2.5">
                        <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
                        <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
                      </div>
                    ))}
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 && !q ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center">
                    <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                      <UserPlus className="h-8 w-8 text-muted-foreground/60" />
                      <p className="text-sm text-muted-foreground">
                        No patients yet. Register your first patient — a name is all it takes.
                      </p>
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditing(null);
                          setDialogOpen(true);
                        }}
                      >
                        <Plus className="h-4 w-4" />
                        Register patient
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : visible.length === 0 && q ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                    No patients match your search.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((p) => (
                  <TableRow
                    key={p.id}
                    onClick={() => navigate(`/patients/${p.id}`)}
                    className="group cursor-pointer"
                  >
                    <TableCell className="px-2 font-medium sm:px-3">
                      {p.last_name}, {p.first_name}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap px-2 text-muted-foreground sm:table-cell sm:px-3">
                      {p.date_of_birth ? formatDate(p.date_of_birth) : "—"}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {p.email ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap px-2 text-muted-foreground tabular-nums sm:px-3">
                      {p.phone ?? "—"}
                    </TableCell>
                    <TableCell className="px-2 sm:px-3">
                      {/* Stacked on a phone, inline on a desktop: side by
                          side they pushed the table into a horizontal
                          scroll. The pencil is a hover affordance and is
                          dropped on touch, where the whole row opens the
                          record anyway. */}
                      <div className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-2">
                        {(balances[p.id] ?? 0) > 0 && (
                          <span
                            className="inline-flex items-center whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                            title="Outstanding balance"
                          >
                            owes {formatMoney(balances[p.id])}
                          </span>
                        )}
                        {p.medical_alerts ? (
                          <span className="inline-flex items-center whitespace-nowrap rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                            {p.medical_alerts.split(",").length} alert{p.medical_alerts.split(",").length === 1 ? "" : "s"}
                          </span>
                        ) : (
                          (balances[p.id] ?? 0) <= 0 && <span className="text-muted-foreground">—</span>
                        )}
                        <button
                          type="button"
                          title="Quick edit"
                          aria-label={`Quick edit ${p.first_name} ${p.last_name}`}
                          className="hidden rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 sm:inline-flex"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(p);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      {/* Quick register / row quick-edit. Creating keeps you on the list; the
          success screen offers “Open record” for when you do want to continue. */}
      <PatientDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patient={editing}
        onSaved={(p) => {
          setPatients((prev) => {
            const rest = prev.filter((x) => x.id !== p.id);
            // Keep the list's alphabetical order (server sorts by last, first).
            const next = [...rest, p];
            next.sort(
              (a, b) =>
                a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name),
            );
            return next;
          });
        }}
        onOpenPatient={(p) => navigate(`/patients/${p.id}`)}
        openPatientLabel="Open record"
      />
    </div>
  );
}
