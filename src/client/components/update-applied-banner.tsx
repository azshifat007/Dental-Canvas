import { useEffect, useState } from "react";
import { PartyPopper, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/hooks/use-router";

/**
 * "Update just applied" banner.
 *
 * The updater relaunches the app after installing; the fresh process has no
 * memory of the update that just happened, so at boot we compare the version
 * recorded on the previous run (localStorage) against the running version
 * (__APP_VERSION__, stamped at build time). A mismatch means an update (or
 * first install) just took effect — show a one-time, dismissible banner with
 * the new version and the changelog.
 *
 * The changelog comes from the update feed: updater.ts saves the pending
 * update's notes to localStorage just before relaunch. When there are no
 * notes (external installer, manual upgrade) we show the version alone.
 *
 * "First install" is excluded — a first run records its version silently so
 * future updates are detected; no banner for a fresh install.
 */

const LAST_VERSION_KEY = "dental-canvas:last-run-version";
const NOTES_KEY = "dental-canvas:update-notes";

export interface AppliedUpdate {
  version: string;
  notes: string;
}

/** Read (and clear) any saved changelog for the update just applied. */
function takeSavedNotes(expectedVersion: string): string {
  try {
    const saved = window.localStorage.getItem(NOTES_KEY);
    if (!saved) return "";
    window.localStorage.removeItem(NOTES_KEY);
    const parsed = JSON.parse(saved) as { version?: string; notes?: string };
    // Only trust notes that match the version we're greeting — a stale entry
    // from a skipped update must never be shown as the current changelog.
    return parsed.version === expectedVersion ? (parsed.notes ?? "") : "";
  } catch {
    return "";
  }
}

/**
 * Detect that the running version differs from the last recorded one.
 * Returns null on first install (no previous version recorded) or when the
 * version is unchanged; otherwise returns { version, notes }.
 */
export function detectAppliedUpdate(): AppliedUpdate | null {
  let previous: string | null = null;
  try {
    previous = window.localStorage.getItem(LAST_VERSION_KEY);
  } catch {
    return null; // private mode etc. — no persistence, no detection
  }
  if (!previous) return null; // first run: record silently, no banner
  if (previous === __APP_VERSION__) return null;
  return { version: __APP_VERSION__, notes: takeSavedNotes(__APP_VERSION__) };
}

/** Record the running version as "seen" (called on dismiss/mount). */
export function recordCurrentVersion(): void {
  try {
    window.localStorage.setItem(LAST_VERSION_KEY, __APP_VERSION__);
  } catch {
    /* non-persistent storage — banner will re-offer next launch, fine */
  }
}

/** Save the pending update's changelog so the banner can show it after relaunch. */
export function saveUpdateNotesForNextBoot(version: string, notes: string): void {
  if (!notes.trim()) return;
  try {
    window.localStorage.setItem(NOTES_KEY, JSON.stringify({ version, notes }));
  } catch {
    /* best effort */
  }
}

/** True once the banner for this version has been dismissed by the user. */
function isDismissedForVersion(version: string): boolean {
  try {
    return window.localStorage.getItem("dental-canvas:update-banner-dismissed") === version;
  } catch {
    return false;
  }
}

function markDismissedForVersion(version: string): void {
  try {
    window.localStorage.setItem("dental-canvas:update-banner-dismissed", version);
  } catch {
    /* best effort */
  }
}

/**
 * Fixed to the bottom-center (toasts sit bottom-right, the error banner uses
 * the same spot but is mutually exclusive in practice). Renders nothing
 * unless an update was just applied and hasn't been dismissed.
 */
export function UpdateAppliedBanner() {
  const [applied, setApplied] = useState<AppliedUpdate | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const { navigate } = useRouter();

  useEffect(() => {
    const found = detectAppliedUpdate();
    if (!found) {
      recordCurrentVersion();
      return;
    }
    // Defer one frame so the banner animates in after first paint.
    const t = window.setTimeout(() => {
      setApplied(found);
      setDismissed(isDismissedForVersion(found.version));
    }, 400);
    return () => window.clearTimeout(t);
  }, []);

  if (!applied || dismissed) return null;

  const dismiss = () => {
    markDismissedForVersion(applied.version);
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 rounded-lg border border-teal-300 bg-card px-4 py-3 shadow-lg dark:border-teal-800 print:hidden"
    >
      <div className="flex items-start gap-3">
        <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-teal-600 dark:text-teal-400" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Dental Canvas updated to <span className="font-semibold">v{applied.version}</span> 🦷
          </p>
          {applied.notes.trim() && (
            <p className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-snug text-muted-foreground">
              {applied.notes.trim()}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigate("/whats-new")}
            className="h-8"
          >
            <Sparkles className="h-4 w-4" />
            What&apos;s new
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss} aria-label="Dismiss update banner" className="h-8 px-2">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
