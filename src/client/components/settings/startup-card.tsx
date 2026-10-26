import { useEffect, useState } from "react";
import { Power } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { autostartSupported, isAutostartEnabled, setAutostart } from "@/lib/autostart";

/**
 * Settings → Appearance → Startup.
 *
 * The switch reflects the OS state, not a preference stored in the database:
 * another launcher (Task Manager → Startup, `systemctl --user`, a LaunchAgent
 * editor) can disable the entry behind our back, and a local boolean would then
 * lie. Reading it on mount keeps the toggle honest.
 */
export function StartupCard() {
  const supported = autostartSupported();
  const [enabled, setEnabled] = useState(false);
  const [known, setKnown] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const value = await isAutostartEnabled();
      if (cancelled) return;
      if (value === null) {
        setKnown(false);
        return;
      }
      setEnabled(value);
      setKnown(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await setAutostart(next);
      setEnabled(next);
      setKnown(true);
      toast.success(next ? "Dental Canvas will start with your computer" : "Launch at login turned off");
    } catch (err) {
      toast.error((err as Error).message || "Could not change the startup setting");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Power className="h-4 w-4" />
          Startup
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Open Dental Canvas automatically when you sign in to this computer, so today's
          schedule, reminders and recalls are ready without hunting for the icon. The
          window opens as usual; nothing else about the app changes.
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Launch at login</p>
            <p className="text-xs text-muted-foreground">
              {!supported
                ? "Available in the desktop app — a browser cannot register a startup entry."
                : known
                  ? enabled
                    ? "On — started by Windows, macOS or your Linux desktop at sign-in."
                    : "Off — open the app yourself after signing in."
                  : "Reading the current setting from the system…"}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Launch at login"
            disabled={!supported || !known || busy}
            onClick={() => toggle(!enabled)}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
              enabled ? "bg-primary" : "bg-muted-foreground/30",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 rounded-full bg-background shadow transition-transform",
                enabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
