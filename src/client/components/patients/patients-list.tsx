import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Search, UserPlus } from "lucide-react";
import { useApp } from "@/context";
import { api } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
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
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>DOB</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Alerts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-12 text-center text-sm text-muted-foreground">
                    Loading…
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
                    <TableCell className="font-medium">
                      {p.last_name}, {p.first_name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {p.date_of_birth ? formatDate(p.date_of_birth) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.email ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.phone ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {(balances[p.id] ?? 0) > 0 && (
                          <span
                            className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-800 dark:bg-rose-950 dark:text-rose-200"
                            title="Outstanding balance"
                          >
                            owes {balances[p.id].toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}
                          </span>
                        )}
                        <div className="flex items-center justify-between gap-2">
                        {p.medical_alerts ? (
                          <span className="inline-flex items-center rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                            {p.medical_alerts.split(",").length} alert{p.medical_alerts.split(",").length === 1 ? "" : "s"}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                        <button
                          type="button"
                          title="Quick edit"
                          aria-label={`Quick edit ${p.first_name} ${p.last_name}`}
                          className="rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(p);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        </div>
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
