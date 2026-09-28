import { useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkForUpdates, getUpdateState, installUpdate, subscribeToUpdates, isUpdateSupported, type UpdateState } from "@/lib/updater";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";

/**
 * In-app updates (desktop): check / download / relaunch. Rendered in
 * Settings → About and re-exported from backup-tab for Settings → Backup.
 * Web builds hide it — the updater is a Tauri-only plugin.
 */
export function UpdateCard() {
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
