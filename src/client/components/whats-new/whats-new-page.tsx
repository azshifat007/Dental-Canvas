import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Sparkles, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  isCurrentVersion,
  loadReleaseHistory,
  type ReleaseEntry,
  type ReleaseHistory,
} from "@/lib/release-history";

/**
 * "What's new" — release history.
 *
 * Lists the recent app versions with their changelogs, fetched from the
 * public GitHub releases feed (the same source the in-app updater uses) and
 * cached locally so the page still works fully offline. Linked from the
 * post-update banner and Settings → About.
 */
export function WhatsNewPage() {
  const [history, setHistory] = useState<ReleaseHistory | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await loadReleaseHistory();
    setHistory(result.history);
    setFromCache(result.fromCache);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const releases = history?.releases ?? [];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b bg-card px-4 py-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Sparkles className="h-5 w-5" /> What&apos;s new
        </h1>
        <p className="hidden text-sm text-muted-foreground sm:block">
          Recent versions and what changed in each one.
        </p>
        <div className="ml-auto flex items-center gap-2">
          {fromCache && !loading && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title="No internet — showing the last downloaded history">
              <WifiOff className="h-3.5 w-3.5" /> Offline copy
            </span>
          )}
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>
      <div className="force-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl">
          {loading && releases.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading release history…</p>
          ) : releases.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              Release history isn&apos;t available right now. Connect to the internet once and it will be
              saved for offline viewing.
            </p>
          ) : (
            <ol className="space-y-3">
              {releases.map((release) => (
                <ReleaseCard key={release.tag} release={release} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function ReleaseCard({ release }: { release: ReleaseEntry }) {
  const current = isCurrentVersion(release.tag);
  return (
    <li
      className={cn(
        "rounded-lg border bg-card p-4",
        current && "border-teal-300 ring-1 ring-teal-300 dark:border-teal-800 dark:ring-teal-800",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">{release.name}</h2>
        {current && (
          <span className="rounded bg-teal-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
            Current
          </span>
        )}
        {release.publishedAt && (
          <span className="ml-auto text-xs text-muted-foreground">{formatDate(release.publishedAt)}</span>
        )}
      </div>
      {release.notes.trim() && (
        <p className="mt-2 whitespace-pre-wrap text-sm leading-snug text-muted-foreground">
          {release.notes.trim()}
        </p>
      )}
    </li>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
