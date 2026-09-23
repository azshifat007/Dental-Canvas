/**
 * Desktop folder auto-backup (Tauri only).
 *
 * On the desktop the whole database lives in the machine's IndexedDB, so the
 * portable JSON backup produced by `/api/backup/export` is the natural
 * folder-backup payload — restorable into any install via Settings → Backup →
 * "Import from file".
 *
 * This module:
 *   1. lets the clinic pick a backup folder once (File System Access API —
 *      supported by WebView2 on Windows),
 *   2. persists the directory handle in IndexedDB so the choice survives
 *      restarts,
 *   3. writes `dental-canvas-backup-<timestamp>.json` into that folder:
 *        - immediately when a folder is first chosen ("on install"), and
 *        - once per week afterwards (checked on mount and then hourly).
 *
 * Permission nuance: a persisted handle still needs `queryPermission` /
 * `requestPermission` on read — but permission only needs re-granting when
 * Chrome clears it (typically after restarts). When permission isn't granted,
 * the module reports `needs_permission` and the Settings card shows a
 * one-click "Re-grant access" button. The weekly timer stays silent otherwise.
 */

import { isTauriDesktop } from "./activate";

// ── File System Access API types (not in the default TS lib) ────────

interface FileSystemWritableFileStream {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  kind: "file";
  name: string;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

export interface FileSystemDirectoryHandle {
  kind: "directory";
  name: string;
  queryPermission(desc?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission(desc?: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  getFileHandle(name: string, opts?: { create?: boolean }): Promise<FileSystemFileHandle>;
  removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
}

// ── IndexedDB handle store ──────────────────────────────────────────

const DB_NAME = "dental-canvas-desktop-backup";
const STORE = "handles";
const HANDLE_KEY = "backup-folder";

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openHandleDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Public API ──────────────────────────────────────────────────────

/** Weekly cadence (the request) — one folder backup per week. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** How often the mounted scheduler re-checks whether a backup is due. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
/** localStorage timestamp keys. */
const LAST_RUN_KEY = "dental-canvas:desktop-backup:last-run";
const EVER_RUN_KEY = "dental-canvas:desktop-backup:ever-run";

/** How many backup files to keep in the folder; older ones are pruned. */
const KEEP_FILES = 12; // ~3 months of weekly backups

export function isDesktopBackupSupported(): boolean {
  return (
    isTauriDesktop() &&
    typeof window !== "undefined" &&
    "showDirectoryPicker" in window &&
    "indexedDB" in window
  );
}

function readStamp(key: string): number {
  const raw = window.localStorage.getItem(key);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) ? n : 0;
}

function writeStamp(key: string, ts: number): void {
  try {
    window.localStorage.setItem(key, String(ts));
  } catch {
    /* private mode — schedule just won't survive reloads */
  }
}

/** Resolve the persisted handle + current permission, or why it isn't usable. */
async function resolveFolder(): Promise<
  | { ok: true; handle: FileSystemDirectoryHandle; granted: boolean }
  | { ok: false; state: "no_folder" | "unsupported" }
> {
  if (!("showDirectoryPicker" in window)) return { ok: false, state: "unsupported" };
  const handle = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  if (!handle) return { ok: false, state: "no_folder" };
  const perm = await handle.queryPermission({ mode: "readwrite" });
  return { ok: true, handle, granted: perm === "granted" };
}

/** List the backup JSON files currently in the folder (for pruning). */
async function listBackupFiles(
  handle: FileSystemDirectoryHandle,
): Promise<{ name: string; handle: FileSystemFileHandle }[]> {
  const out: { name: string; handle: FileSystemFileHandle }[] =
    [];
  for await (const entry of handle.values()) {
    if (entry.kind === "file" && /^dental-canvas-backup-.*\.json$/.test(entry.name)) {
      out.push({ name: entry.name, handle: entry as FileSystemFileHandle });
    }
  }
  return out;
}

/**
 * Write a fresh portable backup into the chosen folder. Returns the filename,
 * or a reason nothing was written (folder missing / permission revoked).
 */
export async function runDesktopBackup(): Promise<
  { ok: true; file: string } | { ok: false; error: string }
> {
  const folder = await resolveFolder();
  if (!folder.ok) return { ok: false, error: "No backup folder chosen" };
  if (!folder.granted) return { ok: false, error: "Folder access permission was revoked" };

  try {
    const res = await fetch("/api/backup/export");
    if (!res.ok) return { ok: false, error: `Backup export failed (HTTP ${res.status})` };
    const blob = await res.blob();

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `dental-canvas-backup-${stamp}.json`;
    const fileHandle = await folder.handle.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    // Prune: keep the newest KEEP_FILES backup files, delete the rest.
    const files = await listBackupFiles(folder.handle);
    files.sort(); // lexicographic = chronological here (ISO stamps)
    const excess = files.length - KEEP_FILES;
    for (let i = 0; i < excess; i++) {
      await folder.handle.removeEntry(files[i].name).catch(() => undefined);
    }

    const ts = Date.now();
    writeStamp(LAST_RUN_KEY, ts);
    writeStamp(EVER_RUN_KEY, ts);
    return { ok: true, file: name };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Pick the backup folder, remember it, and take the first ("on install")
 * backup right away. Call from the Settings card's picker button.
 */
export async function chooseDesktopBackupFolder(): Promise<
  { ok: true; file: string; folderName: string } | { ok: false; error: string }
> {
  if (!("showDirectoryPicker" in window)) {
    return { ok: false, error: "This environment does not support folder access" };
  }
  try {
    // `id` keeps the user's choice remembered across installs for this app.
    const handle = await (
      window as unknown as { showDirectoryPicker(o?: { id?: string; mode?: string }): Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker({ id: "dental-canvas-backups", mode: "readwrite" });
    await idbSet(HANDLE_KEY, handle);
    const first = await runDesktopBackup();
    if (!first.ok) return { ok: false, error: first.error };
    return { ok: true, file: first.file, folderName: handle.name };
  } catch (err) {
    // DOMException AbortError = user cancelled the picker.
    if ((err as DOMException).name === "AbortError") {
      return { ok: false, error: "cancelled" };
    }
    return { ok: false, error: (err as Error).message };
  }
}

/** Re-request readwrite permission after the browser revoked it. */
export async function regrantDesktopBackupPermission(): Promise<boolean> {
  const folder = await resolveFolder();
  if (!folder.ok) return false;
  if (folder.granted) return true;
  const p = await folder.handle.requestPermission({ mode: "readwrite" });
  return p === "granted";
}

/** Forget the folder (stops the weekly backups). */
export async function clearDesktopBackupFolder(): Promise<void> {
  await idbDelete(HANDLE_KEY).catch(() => undefined);
  window.localStorage.removeItem(LAST_RUN_KEY);
  window.localStorage.removeItem(EVER_RUN_KEY);
}

export interface DesktopBackupState {
  supported: boolean;
  /** true when a folder is chosen and (still) permitted. */
  active: boolean;
  folderName: string | null;
  needsPermission: boolean;
  lastRunAt: number;
  nextRunAt: number | null;
}

/** Read the current desktop-backup state for the Settings card. */
export async function getDesktopBackupState(): Promise<DesktopBackupState> {
  const supported = isDesktopBackupSupported();
  if (!supported) {
    return { supported: false, active: false, folderName: null, needsPermission: false, lastRunAt: 0, nextRunAt: null };
  }
  const folder = await resolveFolder();
  if (!folder.ok) {
    return { supported: true, active: false, folderName: null, needsPermission: false, lastRunAt: 0, nextRunAt: null };
  }
  const lastRunAt = readStamp(LAST_RUN_KEY);
  const granted = folder.granted;
  return {
    supported: true,
    active: granted,
    folderName: folder.handle.name,
    needsPermission: !granted,
    lastRunAt,
    nextRunAt: granted ? lastRunAt + WEEK_MS : null,
  };
}

/**
 * The scheduler. Mount once in the app shell (desktop only): checks on mount
 * and hourly whether a weekly backup is due and writes one silently.
 * Returns a cleanup function.
 */
export function startDesktopBackupScheduler(): () => void {
  if (!isDesktopBackupSupported()) return () => undefined;

  let timer: number | null = null;

  const check = async () => {
    const state = await getDesktopBackupState();
    if (!state.active) return; // no folder / permission revoked → stay silent
    if (Date.now() < state.nextRunAt!) return;
    await runDesktopBackup();
  };

  // Give the offline server time to be fully up before the first check.
  const initial = window.setTimeout(() => void check(), 20_000);
  timer = window.setInterval(() => void check(), CHECK_INTERVAL_MS);

  return () => {
    window.clearTimeout(initial);
    if (timer !== null) window.clearInterval(timer);
  };
}
