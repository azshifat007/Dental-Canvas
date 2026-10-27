import { useEffect, useState } from "react";
import { AlertTriangle, Download, ExternalLink, Loader2, RefreshCw, RotateCcw, Search, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  checkForUpdates,
  getUpdateDiagnostics,
  getUpdateState,
  installStagedUpdate,
  installUpdate,
  isUpdateSupported,
  openManualUpdate,
  releasesPageUrl,
  repairCachedAppFiles,
  subscribeToDiagnostics,
  subscribeToUpdates,
  type UpdateDiagnostics,
  type UpdateState,
} from "@/lib/updater";
import { useApp } from "@/context";
import { openExternalUrl } from "@/lib/open-external";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";

/**
 * In-app updates (desktop): check / download / relaunch. Rendered in
 * Settings → About and re-exported from backup-tab for Settings → Backup.
 * Web builds hide it — the updater is a Tauri-only plugin.
 *
 * Every outcome is visible: a failed check now says why it failed instead of
 * quietly reporting "You're on the latest version" (the stuck-machine
 * reports), and when self-install cannot work the card still offers the
 * installer and a cache repair.
 */
export function UpdateCard() {
  const app = useApp();
  const [update, setUpdate] = useState<UpdateState | null>(getUpdateState());
  const [diag, setDiag] = useState<UpdateDiagnostics>(getUpdateDiagnostics());
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [savingMode, setSavingMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeToUpdates(setUpdate), []);
  useEffect(() => subscribeToDiagnostics(setDiag), []);

  if (!isUpdateSupported()) return null;

  // The setting is the source of truth; app.tsx pushes it into the updater (and
  // starts the download when it flips to automatic).
  const autoUpdate = app.settings.update_mode === "auto";

  const setAuto = async (on: boolean) => {
    setSavingMode(true);
    setError(null);
    try {
      await saveUpdateMode(app.updateSettings, on);
    } catch (err) {
      setError(`Could not save the setting: ${(err as Error).message}`);
    } finally {
      setSavingMode(false);
    }
  };

  const checkNow = async () => {
    setChecking(true);
    setError(null);
    try {
      const found = await checkForUpdates();
      if (!found && !getUpdateDiagnostics().lastError) toast.info("You're on the latest version");
    } catch (err) {
      setError(`Could not check for updates: ${(err as Error).message}`);
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    setInstalling(true);
    setError(null);
    try {
      // A staged download installs as-is; otherwise installUpdate() fetches it.
      if (update?.phase === "staged") await installStagedUpdate();
      else await installUpdate();
      // On Windows the installer closes the app during install, so this line
      // is usually never reached — but on other paths the app relaunches.
    } catch (err) {
      setError(`Update failed: ${(err as Error).message}`);
      setInstalling(false);
    }
  };

  const manualDownload = async () => {
    setError(null);
    try {
      await openManualUpdate();
    } catch (err) {
      setError(`Could not open the download page: ${(err as Error).message}`);
      await openExternalUrl(releasesPageUrl());
    }
  };

  const repair = async () => {
    setError(null);
    try {
      await repairCachedAppFiles();
    } catch (err) {
      setError(`Repair failed: ${(err as Error).message}`);
    }
  };

  const checkedAgo = diag.lastCheckedAt ? formatAgo(diag.lastCheckedAt) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw
            className={cn("h-4 w-4 text-teal-600 dark:text-teal-400", (update?.phase === "downloading" || checking) && "animate-spin")}
          />
          App updates
        </CardTitle>
        <span className="text-xs text-muted-foreground">v{__APP_VERSION__}</span>
      </CardHeader>
      <CardContent className="space-y-3">
        {update ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {update.phase === "downloading"
                    ? "Downloading update…"
                    : update.phase === "staged"
                      ? `Version ${update.version} is ready to install`
                      : update.phase === "ready"
                        ? "Update installed — restarting…"
                        : update.mode === "repair"
                          ? `Version ${update.version} is installed, but this screen is running an older copy`
                          : `Version ${update.version} is available`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {update.mode === "repair"
                    ? "The cached app files are out of date. Repair clears them and reloads the current version — your patient data is not touched."
                    : update.mode === "manual"
                      ? "This install cannot update itself. Download the installer once; future updates are automatic again."
                      : update.phase === "staged"
                        ? autoUpdate
                          ? "It installs itself and restarts the app the next time the app is left alone. Install now to do it straight away."
                          : "Downloads are staged until you say so — install whenever it suits."
                        : update.phase === "downloading"
                          ? "The app keeps working while it downloads; the install waits for a quiet moment."
                          : autoUpdate
                            ? "It downloads in the background and installs itself when the app is next left alone."
                            : "Downloads and installs when you click, then restarts the app."}
                </p>
              </div>
              {(update.phase === "available" || update.phase === "staged") && (
                <Button
                  size="sm"
                  onClick={update.mode === "repair" ? repair : update.mode === "manual" ? manualDownload : install}
                  disabled={installing}
                >
                  {installing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : update.mode === "repair" ? (
                    <Wrench className="h-4 w-4" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  {update.mode === "repair"
                    ? "Repair & reload"
                    : update.mode === "manual"
                      ? "Download installer"
                      : update.phase === "staged"
                        ? "Install now"
                        : "Download & install"}
                </Button>
              )}
            </div>
            {update.phase === "downloading" && (
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-teal-500 transition-all"
                  style={{ width: `${Math.round(update.progress * 100)}%` }}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Updates are checked once an hour.{" "}
              {autoUpdate
                ? "A new version downloads in the background and installs itself the next time the app is left alone."
                : "You are told when one is available, and install it with one click."}
            </p>
            <Button size="sm" variant="outline" onClick={checkNow} disabled={checking} className="shrink-0">
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Check now
            </Button>
          </div>
        )}

        {(diag.lastError || error) && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">Automatic update check failed</p>
              <p className="mt-0.5 break-words opacity-90">{error ?? diag.lastError}</p>
              <p className="mt-1 opacity-80">
                You can always install the newest version by hand — your data stays on this computer.
              </p>
            </div>
          </div>
        )}

        <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">Install updates automatically</span>
            <span className="block text-xs text-muted-foreground">
              Ten minutes without anyone touching the app, or thirty seconds with the window in the background,
              is treated as a quiet moment: the update installs itself and the app restarts. An open dialog or
              form is never interrupted. Turn this off to be asked first.
            </span>
          </span>
          <input
            type="checkbox"
            className="h-5 w-5 shrink-0 accent-[var(--primary)]"
            checked={autoUpdate}
            disabled={savingMode}
            onChange={(e) => void setAuto(e.target.checked)}
            aria-label="Install updates automatically"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void manualDownload()}>
            <ExternalLink className="h-3.5 w-3.5" /> Release page
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => void repair()}>
            <RotateCcw className="h-3.5 w-3.5" /> Repair cached files
          </Button>
          <span className="ml-auto" title={diag.feedVersion ? `Release feed: v${diag.feedVersion}` : undefined}>
            {checkedAgo ? `Checked ${checkedAgo}` : "Not checked yet"}
            {diag.feedVersion ? ` · feed v${diag.feedVersion}` : ""}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Store the "install automatically" switch as `update_mode`. The card does not
 * touch the updater itself: the app shell pushes the stored value into it (see
 * the `setUpdateMode` effect in app.tsx), so a failed save cannot leave the app
 * behaving differently from what Settings shows.
 */
export async function saveUpdateMode(
  updateSettings: (patch: { update_mode: "auto" | "ask" }) => Promise<void>,
  enabled: boolean,
): Promise<void> {
  await updateSettings({ update_mode: enabled ? "auto" : "ask" });
}

function formatAgo(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
