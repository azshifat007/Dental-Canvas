import { useEffect, useState } from "react";
import { Download, Loader2, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getUpdateState,
  installUpdate,
  isUpdateSupported,
  openManualUpdate,
  repairCachedAppFiles,
  subscribeToUpdates,
  type UpdateState,
} from "@/lib/updater";

/**
 * "Update available" banner (desktop only).
 *
 * The update state used to be visible only in Settings → About, so a clinic
 * machine that never opened that tab looked permanently stuck on its old
 * version. This surfaces the same state where the user already is, with the
 * action that actually works for that machine: self-install, a one-time
 * installer download, or a cache repair for a stale UI.
 *
 * Dismissing remembers the version, so it never nags twice for the same one.
 *
 * A downloaded ("staged") update keeps the banner up with an "Install now"
 * action, because on an automatically-updating machine the restart can be
 * hours away — whenever the clinic next walks away from the app.
 */

const DISMISSED_KEY = "dental-canvas:update-available-dismissed";

function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

export function UpdateAvailableBanner() {
  // Start from what the updater already knows: an update found before this
  // mounted (the hourly check runs app-wide) is on screen immediately instead
  // of waiting for the first subscription callback.
  const [update, setUpdate] = useState<UpdateState | null>(() => getUpdateState());
  const [dismissed, setDismissed] = useState<string | null>(() => readDismissed());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isUpdateSupported()) return;
    return subscribeToUpdates(setUpdate);
  }, []);

  if (!isUpdateSupported()) return null;
  if (!update) return null;
  if (update.phase !== "available" && update.phase !== "staged") return null;
  if (dismissed === update.version) return null;
  const staged = update.phase === "staged";

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, update.version);
    } catch {
      /* best effort */
    }
    setDismissed(update.version);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (update.mode === "repair") await repairCachedAppFiles();
      else if (update.mode === "manual") await openManualUpdate();
      else await installUpdate();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const label = staged
    ? `Version ${update.version} is ready to install`
    : update.mode === "repair"
      ? "This screen is out of date — repair cached files"
      : update.mode === "manual"
        ? `Version ${update.version} is available — download the installer`
        : `Version ${update.version} is available`;

  const action = staged
    ? "Install now"
    : update.mode === "repair"
      ? "Repair & reload"
      : update.mode === "manual"
        ? "Download installer"
        : "Download & install";

  const hint = staged
    ? "It installs itself and restarts the app the next time it is left alone. Your patient data is not affected."
    : update.mode === "repair"
      ? "Your patient data is not affected."
      : update.mode === "manual"
        ? "Run the installer once; updates are automatic again afterwards."
        : "Downloads in the background, then restarts the app.";

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 rounded-lg border border-teal-300 bg-card px-4 py-3 shadow-lg dark:border-teal-800 print:hidden"
    >
      <div className="flex items-start gap-3">
        <Download className="mt-0.5 h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{label}</p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          {error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <Button size="sm" variant="outline" className="h-8" onClick={() => void run()} disabled={busy}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : update.mode === "repair" ? (
              <Wrench className="h-4 w-4" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {action}
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Dismiss update notice" className="h-8 px-2">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
