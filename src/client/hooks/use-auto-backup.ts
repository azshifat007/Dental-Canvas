import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { onDataChanged } from "../lib/data-change-signal";

/**
 * Timer- and change-triggered auto-backup.
 *
 * The schedule lives in server settings (shared by every device); the countdown
 * itself runs in the browser because the API is serverless — a background
 * worker would be shut down between requests. This hook mounts once in the app
 * shell, counts down to the next due backup, fires POST /api/backup/auto when
 * the timer expires, and records the last run in localStorage so a page reload
 * does not reset the schedule.
 *
 * On top of the timer, meaningful data changes (appointments booked,
 * patients registered, prescriptions written…) also trigger a backup —
 * debounced so a burst of edits produces ONE snapshot, not one per edit.
 * The debounce window scales with the schedule: never more often than
 * MIN_CHANGE_BACKUP_GAP_MS, and the timer still runs unchanged as the
 * catch-all for quiet days.
 */

export interface AutoBackupSettings {
  auto_backup_interval_minutes: number;
  auto_backup_keep: number;
}

const LAST_RUN_KEY = "dental-canvas:last-auto-backup";
/** Re-check the server schedule this often while idle. */
const SCHEDULE_POLL_MS = 5 * 60 * 1000;
/** Once due, retry at most this often (guards against persistent failures). */
const MIN_RETRY_MS = 60 * 1000;
/**
 * Minimum gap between change-triggered backups. Bursts of edits within this
 * window coalesce into one snapshot (the window also serves as the debounce
 * delay — the backup fires once things have been quiet for this long).
 */
const MIN_CHANGE_BACKUP_GAP_MS = 3 * 60 * 1000;
/** Hard cap on how long bursts can keep postponing the backup. */
const MAX_CHANGE_DEBOUNCE_MS = 15 * 60 * 1000;

function readLastRun(): number {
  const raw = window.localStorage.getItem(LAST_RUN_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function writeLastRun(ts: number): void {
  try {
    window.localStorage.setItem(LAST_RUN_KEY, String(ts));
  } catch {
    /* private mode — the timer just won't survive reloads */
  }
}

export interface AutoBackupState {
  /** true when the schedule is enabled (interval > 0). */
  enabled: boolean;
  /** Minutes between backups, from server settings. */
  intervalMinutes: number;
  /** ms until the next backup fires (null while disabled or loading). */
  msRemaining: number | null;
  /** Epoch ms of the last successful auto backup (localStorage). */
  lastRunAt: number;
  /** Bumped whenever a backup completes so the UI can refresh lists. */
  lastCompletedAt: number;
}

export function useAutoBackup(settings: AutoBackupSettings | null): AutoBackupState {
  const [now, setNow] = useState(() => Date.now());
  const [lastRunAt, setLastRunAt] = useState<number>(() => readLastRun());
  const [lastCompletedAt, setLastCompletedAt] = useState(0);
  const runningRef = useRef(false);

  const enabled = !!settings && settings.auto_backup_interval_minutes > 0;
  const intervalMinutes = settings?.auto_backup_interval_minutes ?? 0;

  const runBackup = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      await api("POST", "/api/backup/auto");
      const ts = Date.now();
      writeLastRun(ts);
      setLastRunAt(ts);
      setLastCompletedAt(ts);
    } catch {
      // Transient network/server issues: leave lastRun untouched so the timer
      // retries after its next tick (bounded by MIN_RETRY_MS).
    } finally {
      runningRef.current = false;
    }
  }, []);

  const runChangeBackup = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      await api("POST", "/api/backup/auto", { reason: "data_change" });
      const ts = Date.now();
      writeLastRun(ts);
      setLastRunAt(ts);
      setLastCompletedAt(ts);
    } catch {
      // The timer path remains the safety net for failures here.
    } finally {
      runningRef.current = false;
    }
  }, []);

  // Change-triggered backups: debounced + rate-limited. The timer resets on
  // every signal (burst coalescing) but a hard cap bounds postponement.
  const firstChangeAtRef = useRef(0);
  const debounceRef = useRef<number | null>(null);
  const lastChangeBackupRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    return onDataChanged(() => {
      if (runningRef.current) return;
      const nowMs = Date.now();
      if (!firstChangeAtRef.current) firstChangeAtRef.current = nowMs;

      const schedule = () => {
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        const burstStart = firstChangeAtRef.current;
        const elapsed = nowMs - burstStart;
        // Fire at the debounce gap, unless the burst has gone on too long.
        const wait = Math.max(0, Math.min(MIN_CHANGE_BACKUP_GAP_MS, MAX_CHANGE_DEBOUNCE_MS - elapsed));
        debounceRef.current = window.setTimeout(async () => {
          debounceRef.current = null;
          firstChangeAtRef.current = 0;
          // Rate-limit: skip if a change-backup ran very recently (the timer
          // path also updates lastChangeBackupRef via lastRunAt below).
          if (Date.now() - lastChangeBackupRef.current < MIN_CHANGE_BACKUP_GAP_MS) return;
          lastChangeBackupRef.current = Date.now();
          await runChangeBackup();
        }, wait);
      };
      schedule();
    });
  }, [enabled, runChangeBackup]);

  // Cleanup pending debounce when the schedule turns off or the app unmounts.
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, []);

  // 1s heartbeat — cheap, drives the visible countdown.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);



  // Fire when due. The countdown restarts from the server interval after each
  // successful run; localStorage anchors it across reloads.
  useEffect(() => {
    if (!settings || !enabled) return;
    const dueAt = lastRunAt + intervalMinutes * 60_000;
    if (now < dueAt) return;
    // Avoid hammering a failing endpoint every heartbeat tick.
    if (now - Math.max(lastRunAt, 0) < MIN_RETRY_MS) return;
    void runBackup();
  }, [now, enabled, intervalMinutes, lastRunAt, settings, runBackup]);

  // First run: if backups were never taken and the schedule is on, do one
  // shortly after mount so there is always at least one recent snapshot.
  useEffect(() => {
    if (!enabled || lastRunAt > 0) return;
    const t = window.setTimeout(() => void runBackup(), 15_000);
    return () => window.clearTimeout(t);
  }, [enabled, lastRunAt, runBackup]);

  const msRemaining = enabled
    ? Math.max(0, lastRunAt + intervalMinutes * 60_000 - now)
    : null;

  return { enabled, intervalMinutes, msRemaining, lastRunAt, lastCompletedAt };
}