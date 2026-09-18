import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  HardDriveDownload,
  Loader2,
  RotateCcw,
  Save,
  Timer,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
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

// ── API shapes ─────────────────────────────────────────────────────

interface Snapshot {
  id: number;
  kind: string;
  trigger: string;
  table_counts: Record<string, number> | null;
  size_bytes: number | null;
  created_at: string;
}

interface SnapshotsResponse {
  snapshots: Snapshot[];
  stats: { count: number; total_bytes: number; last_at: string | null };
}

interface InspectResponse {
  ok: boolean;
  version: number;
  created_at: string;
  clinic_name: string | null;
  counts: Record<string, number>;
}

export type BackupMessage = { tone: "ok" | "err"; text: string } | null;

const TRIGGER_LABELS: Record<string, string> = {
  timer: "Auto (timer)",
  user: "Manual",
  "pre-import": "Safety copy before import",
  "pre-restore": "Safety copy before restore",
};

const INTERVAL_CHOICES = [
  { value: "0", label: "Off" },
  { value: "15", label: "Every 15 minutes" },
  { value: "30", label: "Every 30 minutes" },
  { value: "60", label: "Every hour" },
  { value: "180", label: "Every 3 hours" },
  { value: "360", label: "Every 6 hours" },
  { value: "720", label: "Every 12 hours" },
  { value: "1440", label: "Daily" },
  { value: "10080", label: "Weekly" },
];

function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCountdown(ms: number | null): string {
  if (ms === null) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

// ── Tab root ───────────────────────────────────────────────────────

export function BackupTab() {
  const app = useApp();
  const [snapshots, setSnapshots] = useState<SnapshotsResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<BackupMessage>(null);

  const reload = useCallback(async () => {
    try {
      const res = await api<SnapshotsResponse>("GET", "/api/backup/snapshots");
      setSnapshots(res);
    } catch (err) {
      app.setError((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function snapshotNow() {
    setBusy("snapshot");
    setMessage(null);
    try {
      await api("POST", "/api/backup/snapshots");
      setMessage({ tone: "ok", text: "Snapshot created." });
      await reload();
    } catch (err) {
      setMessage({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function removeSnapshot(id: number) {
    if (!confirm("Delete this snapshot permanently?")) return;
    setBusy(`del-${id}`);
    try {
      await api("DELETE", `/api/backup/snapshots/${id}`);
      await reload();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function restoreSnapshot(id: number) {
    const snap = snapshots?.snapshots.find((s) => s.id === id);
    const when = snap ? formatDate(snap.created_at) : "this snapshot";
    if (
      !confirm(
        `Restore data from ${when}?\n\nThis REPLACES all current data with the snapshot's contents. A safety snapshot of the current data is taken first.`,
      )
    )
      return;
    setBusy(`restore-${id}`);
    setMessage(null);
    try {
      await api("POST", `/api/backup/snapshots/${id}/restore`);
      setMessage({ tone: "ok", text: "Restored. Refreshing app data…" });
      await app.refreshLookups();
      await app.refreshSidePanels();
      setMessage({ tone: "ok", text: "Restore complete." });
      await reload();
    } catch (err) {
      setMessage({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* CSV exports for accountants / record-keeping. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
        <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">
          Spreadsheet exports (open in Excel / Sheets)
        </span>
        <a
          href="/api/export/patients.csv"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent"
        >
          <Download className="h-3.5 w-3.5" /> Patients CSV
        </a>
        <a
          href="/api/export/invoices.csv"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent"
        >
          <Download className="h-3.5 w-3.5" /> Invoices CSV
        </a>
      </div>

      {message && (
        <div
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            message.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200"
              : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200",
          )}
        >
          {message.text}
        </div>
      )}

      <PortableCard onDone={reload} setMessage={setMessage} />
      <ScheduleCard />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span>Snapshots</span>
            <Button size="sm" onClick={snapshotNow} disabled={busy === "snapshot"}>
              {busy === "snapshot" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <HardDriveDownload className="h-4 w-4" />
              )}
              Snapshot now
            </Button>
          </CardTitle>
          {snapshots && (
            <p className="text-sm text-muted-foreground">
              {snapshots.stats.count} snapshot{snapshots.stats.count === 1 ? "" : "s"} ·{" "}
              {formatBytes(snapshots.stats.total_bytes)} · last {formatDate(snapshots.stats.last_at)}
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-2">
          {!snapshots ? (
            <p className="py-4 text-sm text-muted-foreground">Loading…</p>
          ) : snapshots.snapshots.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No snapshots yet. Take one now, or enable the timer above so the app saves one automatically.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2 font-semibold">Created</th>
                    <th className="px-3 py-2 font-semibold">Type</th>
                    <th className="px-3 py-2 text-right font-semibold">Rows</th>
                    <th className="px-3 py-2 text-right font-semibold">Size</th>
                    <th className="px-3 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshots.snapshots.map((s) => {
                    const rows = s.table_counts
                      ? Object.entries(s.table_counts)
                          .filter(([, n]) => n > 0)
                          .map(([t, n]) => `${t} ${n}`)
                          .join(", ")
                      : "";
                    const b = busy === `del-${s.id}` || busy === `restore-${s.id}`;
                    return (
                      <tr key={s.id} className="border-b last:border-0">
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{formatDate(s.created_at)}</td>
                        <td className="px-3 py-2 text-muted-foreground">{TRIGGER_LABELS[s.trigger] ?? s.trigger}</td>
                        <td className="max-w-[240px] truncate px-3 py-2 text-right text-xs text-muted-foreground" title={rows}>
                          {rows || "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                          {formatBytes(s.size_bytes)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex justify-end gap-1">
                            <a
                              href={`/api/backup/snapshots/${s.id}`}
                              download
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent"
                              title="Download snapshot"
                            >
                              <Download className="h-4 w-4" />
                            </a>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={b}
                              onClick={() => restoreSnapshot(s.id)}
                              title="Restore this snapshot"
                            >
                              {busy === `restore-${s.id}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4" />
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              disabled={b}
                              onClick={() => removeSnapshot(s.id)}
                              title="Delete snapshot"
                            >
                              {busy === `del-${s.id}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4 text-muted-foreground" />
                              )}
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

// ── Export / Import card ───────────────────────────────────────────

function PortableCard({
  onDone,
  setMessage,
}: {
  onDone: () => Promise<void>;
  setMessage: (m: BackupMessage) => void;
}) {
  const app = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [inspect, setInspect] = useState<InspectResponse | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  function pickFile() {
    fileRef.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setInspect(null);
    setPendingFile(file);
    setBusy(true);
    setMessage(null);
    try {
      const text = await file.text();
      const res = await fetch("/api/backup/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: text,
      });
      const data = (await res.json()) as InspectResponse | { error: string };
      if (!res.ok || !("ok" in data)) {
        setMessage({ tone: "err", text: (data as { error: string }).error ?? "Invalid backup file" });
        setPendingFile(null);
      } else {
        setInspect(data);
      }
    } catch (err) {
      setMessage({ tone: "err", text: (err as Error).message });
      setPendingFile(null);
    } finally {
      setBusy(false);
    }
  }

  async function doImport() {
    if (!pendingFile) return;
    if (!confirm("Import will REPLACE all current data with the backup's contents.\n\nA safety snapshot of the current data is taken first. Continue?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const text = await pendingFile.text();
      const res = await api<{ imported_rows: number }>("POST", "/api/backup/import", JSON.parse(text));
      setMessage({ tone: "ok", text: `Imported ${res.imported_rows} rows. Refreshing app data…` });
      await app.refreshLookups();
      await app.refreshSidePanels();
      setMessage({ tone: "ok", text: "Import complete." });
      setInspect(null);
      setPendingFile(null);
      await onDone();
    } catch (err) {
      setMessage({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Portable backup file</CardTitle>
        <p className="text-sm text-muted-foreground">
          A single JSON file containing every patient, appointment, chart, note, invoice, insurance record, lab
          case and setting — restorable into any Dental Canvas install.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <a
          href="/api/backup/export"
          download
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Download className="h-4 w-4" /> Export all data
        </a>
        <Button variant="outline" onClick={pickFile} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Import from file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={onFileChosen}
        />

        {inspect && (
          <div className="mt-3 w-full rounded-md border bg-muted/30 p-3 text-sm">
            <div className="font-medium">
              {inspect.clinic_name ? `${inspect.clinic_name} — ` : ""}backup v{inspect.version} from{" "}
              {formatDate(inspect.created_at)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {Object.entries(inspect.counts)
                .filter(([, n]) => n > 0)
                .map(([t, n]) => `${t} (${n})`)
                .join(" · ") || "Empty backup"}
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={doImport} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Import this backup
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setInspect(null);
                  setPendingFile(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Auto-backup schedule card ──────────────────────────────────────

function ScheduleCard() {
  const app = useApp();
  const [interval, setInterval] = useState<string>(String(app.backupSchedule.auto_backup_interval_minutes));
  const [keep, setKeep] = useState<string>(String(app.backupSchedule.auto_backup_keep));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setInterval(String(app.backupSchedule.auto_backup_interval_minutes));
    setKeep(String(app.backupSchedule.auto_backup_keep));
  }, [app.backupSchedule]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    try {
      await app.updateBackupSchedule({
        auto_backup_interval_minutes: parseInt(interval, 10) || 0,
        auto_backup_keep: parseInt(keep, 10) || 10,
      });
      setSaved(true);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const enabled = parseInt(interval, 10) > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="h-4 w-4" />
          Automatic backups
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          While the app is open, a snapshot is taken automatically on schedule. Snapshots beyond the limit are
          pruned oldest-first. Snapshots are stored server-side in the database.
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs">Interval</Label>
            <Select value={interval} onValueChange={setInterval}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_CHOICES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Keep last</Label>
            <Input
              type="number"
              min="1"
              max="100"
              value={keep}
              onChange={(e) => setKeep(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
        </form>
        {saved && <p className="mt-3 text-xs text-emerald-700">Saved ✓</p>}
        {enabled && (
          <p className="mt-2 text-xs text-muted-foreground">
            Timer runs while Dental Canvas is open in any tab of this device.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
