import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  HardDriveDownload,
  HardDriveUpload,
  FolderSync,
  Loader2,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Timer,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { getOfflineDbStatus, isTauriDesktop } from "@/offline/activate";
import { checkForUpdates, getUpdateState, installUpdate, subscribeToUpdates, isUpdateSupported, type UpdateState } from "@/lib/updater";
import {
  chooseDesktopBackupFolder,
  clearDesktopBackupFolder,
  getDesktopBackupState,
  regrantDesktopBackupPermission,
  runDesktopBackup,
  type DesktopBackupState,
} from "@/offline/desktop-backup";
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

// ── In-app updates (desktop): check / download / relaunch ─────────

function UpdateCard() {
  const [update, setUpdate] = useState<UpdateState | null>(getUpdateState());
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeToUpdates(setUpdate), []);

  if (!isUpdateSupported()) return null;

  const checkNow = async () => {
    setChecking(true);
    setError(null);
    try {
      await checkForUpdates();
      if (!getUpdateState()) toast.info("You're on the latest version");
    } catch {
      setError("Could not reach the update feed. Check the internet connection and try again.");
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      await installUpdate();
      // On Windows the installer closes the app during install, so this line
      // is usually never reached — but on other paths the app relaunches.
    } catch (err) {
      setError(`Update failed: ${(err as Error).message}`);
      setInstalling(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className={cn("h-4 w-4 text-teal-600 dark:text-teal-400", update?.phase === "downloading" && "animate-spin")} />
          App updates
        </CardTitle>
        <span className="text-xs text-muted-foreground">v{__APP_VERSION__}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {update ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">
                  {update.phase === "downloading" ? "Downloading update…" : update.phase === "ready" ? "Update installed — restarting…" : `Version ${update.version} is available`}
                </p>
                {update.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{update.notes}</p>}
              </div>
              {update.phase === "available" && (
                <Button size="sm" onClick={install} disabled={installing}>
                  {installing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  Download &amp; install
                </Button>
              )}
            </div>
            {update.phase === "downloading" && (
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-teal-500 transition-all" style={{ width: `${Math.round(update.progress * 100)}%` }} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Updates are checked automatically once an hour. New versions install in the background and the app restarts itself — no installer download needed.
            </p>
            <Button size="sm" variant="outline" onClick={checkNow} disabled={checking} className="shrink-0">
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Check now
            </Button>
          </div>
        )}
        {error && <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      </CardContent>
    </Card>
  );
}

// ── Data-safety status (desktop): DB flush + folder backup recency ──

function DataSafetyRow() {
  const [dbSavedAt, setDbSavedAt] = useState<number | null>(null);
  const [serverReady, setServerReady] = useState(false);
  const [backupState, setBackupState] = useState<DesktopBackupState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Mirror for the poll loop (avoids effect churn when readiness flips).
  const serverReadyRef = useRef(false);

  const reload = useCallback(async () => {
    const status = isTauriDesktop() ? await getOfflineDbStatus() : null;
    serverReadyRef.current = status ? status.serverReady : false;
    setDbSavedAt(status ? status.lastSavedAt : null);
    setServerReady(status ? status.serverReady : false);
    if (isTauriDesktop()) setBackupState(await getDesktopBackupState());
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    let stop = false;
    // The service worker cold-starts lazily (it's killed after ~30s idle), so
    // the first probe can arrive before the in-worker server finishes init.
    // Poll until healthy instead of freezing on "starting…".
    const tick = async () => {
      await reload();
      if (stop) return;
      if (!serverReadyRef.current) setTimeout(() => !stop && void tick(), 1500);
    };
    void tick();
    // Ticker so the "x min ago" labels stay honest.
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      stop = true;
      window.clearInterval(t);
    };
  }, [reload]);

  if (!isTauriDesktop()) return null;

  const ago = (ms: number) => {
    if (ms <= 0) return "never";
    const s = Math.floor((now - ms) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h ago`;
    return `${Math.floor(h / 24)} d ago`;
  };

  // Healthy = backend up and the DB has been persisted at least once (a fresh
  // install persists the seeded schema immediately, so 0 here means trouble).
  const dbOk = serverReady && (dbSavedAt ?? 0) > 0;
  const folderOk = (backupState?.active ?? false) && (backupState?.lastRunAt ?? 0) > 0;

  const dot = (ok: boolean) => (
    <span
      className={cn(
        "inline-block h-2.5 w-2.5 shrink-0 rounded-full",
        ok ? "bg-emerald-500" : (dbSavedAt !== null || backupState !== null) ? "bg-amber-500" : "bg-muted-foreground/40",
      )}
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
      <span className="flex items-center gap-2">
        {dot(dbOk)}
        <span className="text-muted-foreground">Data saved to this computer:</span>
        <span className="font-medium" title={dbSavedAt ? new Date(dbSavedAt).toLocaleString() : undefined}>
          {dbOk ? ago(dbSavedAt!) : serverReady ? "pending…" : "starting…"}
        </span>
      </span>
      <span className="flex items-center gap-2">
        {dot(folderOk)}
        <span className="text-muted-foreground">Folder backup:</span>
        <span className="font-medium">
          {backupState === null
            ? "…"
            : backupState.active
              ? `${ago(backupState.lastRunAt)}${backupState.nextRunAt ? ` · next ${new Date(backupState.nextRunAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}`
              : "not set up"}
        </span>
      </span>
    </div>
  );
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
        <a
          href="/api/export/appointments.csv"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent"
        >
          <Download className="h-3.5 w-3.5" /> Appointments CSV
        </a>
        <a
          href="/api/export/treatments.csv"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-accent"
        >
          <Download className="h-3.5 w-3.5" /> Treatments CSV
        </a>
      </div>

      <DataSafetyRow />
      <UpdateCard />
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
      <DesktopFolderCard setMessage={setMessage} />
      <GoogleDriveCard setMessage={setMessage} />

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

// ── Desktop folder auto-backup (Tauri only) ─────────────────────────

function DesktopFolderCard({ setMessage }: { setMessage: (m: BackupMessage) => void }) {
  const [state, setState] = useState<DesktopBackupState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setState(await getDesktopBackupState());
  }, []);

  useEffect(() => {
    if (isTauriDesktop()) void reload();
  }, [reload]);

  if (!isTauriDesktop()) return null;
  if (!state) return null; // still loading (desktop only)

  async function pickFolder() {
    setBusy("pick");
    setMessage(null);
    try {
      const res = await chooseDesktopBackupFolder();
      if (res.ok) {
        setMessage({ tone: "ok", text: `Backup folder set to "${res.folderName}" — first backup written (${res.file}).` });
      } else if (res.error !== "cancelled") {
        setMessage({ tone: "err", text: res.error });
      }
    } finally {
      setBusy(null);
      await reload();
    }
  }

  async function regrant() {
    setBusy("regrant");
    try {
      const ok = await regrantDesktopBackupPermission();
      if (ok) {
        // Permission restored — take a fresh backup right away so the folder
        // isn't stale while the clinic catches up.
        const r = await runDesktopBackup();
        setMessage(
          r.ok
            ? { tone: "ok", text: `Access restored — backup written (${r.file}).` }
            : { tone: "err", text: r.error },
        );
      }
    } finally {
      setBusy(null);
      await reload();
    }
  }

  async function backupNow() {
    setBusy("now");
    setMessage(null);
    try {
      const r = await runDesktopBackup();
      setMessage(
        r.ok
          ? { tone: "ok", text: `Backup written to "${state?.folderName}" (${r.file}).` }
          : { tone: "err", text: r.error },
      );
    } finally {
      setBusy(null);
      await reload();
    }
  }

  async function stop() {
    if (!confirm(`Stop automatic folder backups and forget "${state?.folderName ?? "the folder"}"?

Existing backup files in the folder are not deleted.`)) return;
    setBusy("stop");
    try {
      await clearDesktopBackupFolder();
      setMessage({ tone: "ok", text: "Automatic folder backups stopped." });
    } finally {
      setBusy(null);
      await reload();
    }
  }

  const fmtDate = (ms: number) =>
    ms > 0
      ? new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderSync className="h-4 w-4" />
          Folder auto-backup (this computer)
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Writes a full portable backup file into a folder on this computer — once when you set it up, then
          automatically once a week while the app is open. Keeps the last 12 files. Works fully offline.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!state.supported ? (
          <p className="text-sm text-muted-foreground">
            This environment does not support folder access. Update the desktop app to use this feature.
          </p>
        ) : state.needsPermission ? (
          <div className="space-y-2">
            <p className="text-sm">
              Access to <span className="font-medium">{state.folderName}</span> was revoked — re-grant it to
              resume automatic backups.
            </p>
            <Button size="sm" onClick={regrant} disabled={busy !== null}>
              {busy === "regrant" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSync className="h-4 w-4" />}
              Re-grant access
            </Button>
          </div>
        ) : !state.active ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={pickFolder} disabled={busy !== null}>
              {busy === "pick" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderSync className="h-4 w-4" />}
              Choose backup folder…
            </Button>
            <span className="text-xs text-muted-foreground">A backup is written immediately, then weekly.</span>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <span className="min-w-0 flex-1 text-sm">
                Backing up to <span className="font-medium">{state.folderName}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  weekly · next {fmtDate(state.nextRunAt ?? 0)}
                </span>
              </span>
              <Button size="sm" variant="outline" onClick={backupNow} disabled={busy !== null}>
                {busy === "now" ? <Loader2 className="h-4 w-4 animate-spin" /> : <HardDriveDownload className="h-4 w-4" />}
                Back up now
              </Button>
              <Button size="sm" variant="ghost" onClick={stop} disabled={busy !== null}>
                Stop
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Last folder backup: {fmtDate(state.lastRunAt)} · restores via "Import from file" above.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── Google Drive backup destination ────────────────────────────────

interface DriveStatus {
  configured: boolean;
  has_credentials: boolean;
  enabled: boolean;
  folder_id: string | null;
  last_upload_at: string | null;
  last_upload_ok: boolean;
  last_upload_error: string | null;
}

function GoogleDriveCard({ setMessage }: { setMessage: (m: BackupMessage) => void }) {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [folderId, setFolderId] = useState("");
  const [hasSecret, setHasSecret] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [st, cfg] = await Promise.all([
          api<DriveStatus>("GET", "/api/backup/drive/status"),
          api<{ settings: Record<string, string> }>("GET", "/api/settings"),
        ]);
        setStatus(st);
        setClientId(cfg.settings.gdrive_client_id ?? "");
        setHasSecret(Boolean((cfg.settings.gdrive_client_secret ?? "").trim()));
        setFolderId(cfg.settings.gdrive_folder_id ?? "");
      } catch {
        // Status stays null → the card shows a load error state via status.
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // OAuth round-trip lands back on /settings?tab=backup&drive_connected=1
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("drive_connected");
    const error = params.get("drive_error");
    if (connected || error) {
      setMessage(
        connected
          ? { tone: "ok", text: "Google Drive connected. Enable it below to include automatic backups." }
          : { tone: "err", text: `Google Drive connection failed: ${error}` },
      );
      window.history.replaceState(null, "", "/settings");
      // Refresh status now that the token is stored.
      api<DriveStatus>("GET", "/api/backup/drive/status").then(setStatus).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault();
    setBusy("config");
    setMessage(null);
    try {
      const body: Record<string, unknown> = {};
      if (clientId.trim()) body.client_id = clientId.trim();
      if (clientSecret.trim()) body.client_secret = clientSecret.trim();
      body.folder_id = folderId.trim();
      const res = await api<DriveStatus>("PUT", "/api/backup/drive/config", body);
      setStatus((s) => (s ? { ...s, ...res } : res));
      if (clientSecret.trim()) setHasSecret(true);
      setClientSecret("");
      setMessage({ tone: "ok", text: "Google Drive configuration saved." });
    } catch (err) {
      setMessage({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function connect() {
    // Full-page navigation to the consent screen; the callback redirects back.
    window.location.href = "/api/backup/drive/auth";
  }

  async function toggleEnabled(enabled: boolean) {
    setBusy("enable");
    setMessage(null);
    try {
      const res = await api<DriveStatus>("PUT", "/api/backup/drive/config", { enabled });
      setStatus((s) => (s ? { ...s, enabled: res.enabled } : s));
    } catch (err) {
      setMessage({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function testConnection() {
    setBusy("test");
    setMessage(null);
    try {
      await api("POST", "/api/backup/drive/test");
      setMessage({ tone: "ok", text: "Test file uploaded to Google Drive — check your folder." });
      setStatus((s) => (s ? { ...s, last_upload_ok: true, last_upload_error: null, last_upload_at: new Date().toISOString() } : s));
    } catch (err) {
      setMessage({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect Google Drive? Your account's access is revoked and automatic uploads stop. The client ID and secret stay saved for next time.")) return;
    setBusy("disconnect");
    setMessage(null);
    try {
      await api("POST", "/api/backup/drive/disconnect");
      setStatus((s) => (s ? { ...s, configured: false, enabled: false, last_upload_at: null, last_upload_error: null } : s));
      setHasSecret(false);
      setMessage({ tone: "ok", text: "Google Drive disconnected." });
    } catch (err) {
      setMessage({ tone: "err", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveUpload className="h-4 w-4" />
          Google Drive backup
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Mirror every backup to your own Google Drive. The app requests only
          access to files it creates — it can never see other files in your
          Drive. Requires a Google Cloud OAuth client (Web application) with
          your site's origin as an authorized redirect origin.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!loaded ? (
          <p className="py-2 text-sm text-muted-foreground">Loading…</p>
        ) : !status ? (
          <p className="text-sm text-muted-foreground">Could not load Drive status.</p>
        ) : (
          <>
            {/* Connection row */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
              <span
                className={cn(
                  "inline-flex h-2.5 w-2.5 rounded-full",
                  status.configured ? "bg-emerald-500" : "bg-muted-foreground/40",
                )}
              />
              <span className="min-w-0 flex-1 text-sm">
                {status.configured ? (
                  <>
                    Connected to Google Drive
                    {status.enabled && <span className="ml-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">Auto-upload ON</span>}
                    {!status.enabled && <span className="ml-2 text-xs text-muted-foreground">Auto-upload off</span>}
                  </>
                ) : status.has_credentials ? (
                  "Credentials saved — connect your Google account to finish"
                ) : (
                  "Not connected"
                )}
              </span>
              {status.configured ? (
                <>
                  <Button size="sm" variant="outline" onClick={testConnection} disabled={busy !== null}>
                    {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
                    Test
                  </Button>
                  <Button size="sm" variant="ghost" onClick={disconnect} disabled={busy !== null}>
                    Disconnect
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={connect} disabled={busy !== null}>
                  {status.has_credentials ? "Connect Google account" : "Connect (save credentials first)"}
                </Button>
              )}
            </div>

            {/* Last upload outcome */}
            {status.last_upload_at && (
              <p className="text-xs text-muted-foreground">
                Last upload: {formatDate(status.last_upload_at)} —{" "}
                {status.last_upload_ok ? (
                  <span className="text-emerald-700 dark:text-emerald-400">succeeded</span>
                ) : (
                  <span className="text-rose-700 dark:text-rose-400">failed: {status.last_upload_error}</span>
                )}
              </p>
            )}

            {/* Credentials form (also usable to re-point at a different client) */}
            <form onSubmit={saveConfig} className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">OAuth client ID</Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="xxxxx.apps.googleusercontent.com"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Client secret {hasSecret && <span className="text-muted-foreground">(saved — leave blank to keep)</span>}</Label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={hasSecret ? "••••••••" : "GOCSPX-…"}
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Folder ID (optional)</Label>
                <Input
                  value={folderId}
                  onChange={(e) => setFolderId(e.target.value)}
                  placeholder="Auto: 'Dental Canvas Backups' folder"
                />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" variant="outline" size="sm" disabled={busy !== null}>
                  {busy === "config" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save configuration
                </Button>
              </div>
            </form>

            {/* Auto-upload toggle */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">Upload automatic backups to Drive</p>
                <p className="text-xs text-muted-foreground">
                  When on, every scheduled and manual snapshot is also copied to Drive. Snapshots keep
                  being stored locally regardless — Drive is a mirror, not a replacement.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={status.enabled}
                disabled={!status.configured || busy !== null}
                onClick={() => toggleEnabled(!status.enabled)}
                className={cn(
                  "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                  status.enabled ? "bg-primary" : "bg-muted-foreground/30",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
                    status.enabled ? "translate-x-6" : "translate-x-1",
                  )}
                />
              </button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
