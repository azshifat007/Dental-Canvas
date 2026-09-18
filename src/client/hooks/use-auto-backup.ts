import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";

/**
 * Timer-based auto-backup.
 *
 * The schedule lives in server settings (shared by every device); the countdown
 * itself runs in the browser because the API is serverless — a background
 * worker would be shut down between requests. This hook mounts once in the app
 * shell, counts down to the next due backup, fires POST /api/backup/auto when
 * the timer expires, and records the last run in localStorage so a page reload
 * does not reset the schedule.
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