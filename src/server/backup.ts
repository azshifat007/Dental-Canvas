import { query, get, run } from "./db";
import { invalidateSearchIndex } from "./search";

/**
 * Portable backups: a complete JSON dump of every data table, importable back
 * into an empty or existing database. The format is versioned so future
 * releases can migrate old exports on import.
 *
 * The dump excludes derived tables (search_index — rebuilt automatically) and
 * the backups table itself (a snapshot must never include snapshots).
 */

export const BACKUP_FORMAT_VERSION = 2;

/**
 * Restore order matters: parents before children (FK constraints), and
 * `settings` / `dentist_notes` / `backups` have no parents. `search_index` is
 * intentionally absent — it is derived and rebuilt after import.
 */
export const BACKUP_TABLES = [
  "settings",
  "operatories",
  "practitioners",
  "treatment_types",
  "medicines",
  "inventory_items",
  "inventory_alerts",
  "inventory_movements",
  "patients",
  "appointments",
  "patient_images",
  "patient_image_blobs",
  "treatment_plan_items",
  "clinical_notes",
  "tooth_conditions",
  "invoices",
  "invoice_items",
  "invoice_payments",
  "waiting_list",
  "insurance_plans",
  "lab_cases",
  "appointments_to_make",
  "dentist_notes",
  "prescriptions",
  "prescription_items",
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

export interface BackupPayload {
  format: "dental-canvas-backup";
  version: number;
  created_at: string;
  /** Source practice name, if configured — informational only. */
  clinic_name?: string;
  tables: { [K in BackupTable]: unknown[] };
}

export interface BackupSummary {
  id: number;
  kind: string;
  trigger: string;
  table_counts: Record<string, number> | null;
  size_bytes: number | null;
  created_at: string;
}

// ── Dump ───────────────────────────────────────────────────────────

function tableRowCounts(payload: BackupPayload): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) counts[t] = payload.tables[t]?.length ?? 0;
  return counts;
}

/**
 * Read every backed-up table. Each table is fetched defensively so a missing
 * table (partially-migrated dev DB) degrades to `[]` instead of failing the
 * whole export.
 */
export async function dumpAllData(): Promise<BackupPayload> {
  const tables = {} as BackupPayload["tables"];
  await Promise.all(
    BACKUP_TABLES.map(async (t) => {
      try {
        tables[t] = await query<unknown>(`SELECT * FROM ${t}`);
      } catch {
        tables[t] = [];
      }
    }),
  );
  const clinic = (tables.settings as { key: string; value: string }[] | undefined)
    ?.find((r) => r.key === "clinic_name")?.value;

  return {
    format: "dental-canvas-backup",
    version: BACKUP_FORMAT_VERSION,
    created_at: new Date().toISOString(),
    clinic_name: clinic || undefined,
    tables,
  };
}

export function countRows(payload: BackupPayload): Record<string, number> {
  return tableRowCounts(payload);
}

// ── Restore ────────────────────────────────────────────────────────

const MAX_IMPORT_BYTES = 64 * 1024 * 1024; // 64 MB — generous for a practice DB

export function validateBackupPayload(raw: unknown): { ok: true; data: BackupPayload } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Backup must be a JSON object" };
  const p = raw as Partial<BackupPayload>;
  if (p.format !== "dental-canvas-backup") {
    return { ok: false, error: "Not a Dental Canvas backup (missing format marker)" };
  }
  if (typeof p.version !== "number") return { ok: false, error: "Backup version is missing" };
  if (p.version > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: `Backup was made by a newer version (${p.version} > ${BACKUP_FORMAT_VERSION}). Update the app first.` };
  }
  if (!p.tables || typeof p.tables !== "object") return { ok: false, error: "Backup has no tables" };
  for (const t of BACKUP_TABLES) {
    if (p.tables[t] !== undefined && !Array.isArray(p.tables[t])) {
      return { ok: false, error: `Table "${t}" must be an array` };
    }
  }
  return { ok: true, data: p as BackupPayload };
}

export function isPayloadTooLarge(jsonText: string): boolean {
  return jsonText.length > MAX_IMPORT_BYTES;
}

/**
 * Identity columns that must be preserved for FK integrity. Everything else is
 * rebuilt row-by-row with explicit ids. Rows are inserted in id order per
 * table so SQLite keeps AUTOINCREMENT ahead of the imported ids.
 */
function insertRows(table: BackupTable, rows: unknown[]): Promise<number> {
  return (async () => {
    let n = 0;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      const cols = Object.keys(rec).filter((k) => rec[k] !== undefined);
      if (cols.length === 0) continue;
      const placeholders = cols.map(() => "?").join(", ");
      const values = cols.map((k) => {
        const v = rec[k];
        // Booleans aren't a SQLite storage class — normalize like the API does.
        if (typeof v === "boolean") return v ? 1 : 0;
        return v;
      });
      await run(
        `INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`,
        values,
      );
      n += 1;
    }
    return n;
  })();
}

/** Human-facing per-table result counts for the UI. */
export type RestoreCounts = Partial<Record<BackupTable, number>>;

/**
 * Replace the entire dataset with the backup's contents.
 * Deletes (children first), re-inserts (parents first), then rebuilds the
 * derived search index. Not transactional across statements (D1 has no
 * multi-statement API from the worker); a failed import leaves the safety
 * snapshot as the recovery path.
 */
export async function restoreFromBackup(payload: BackupPayload): Promise<RestoreCounts> {
  // 1. Wipe children → parents (reverse restore order).
  for (const t of [...BACKUP_TABLES].reverse()) {
    await run(`DELETE FROM ${t}`).catch(() => undefined);
  }

  // 2. Re-insert parents → children.
  const counts: RestoreCounts = {};
  for (const t of BACKUP_TABLES) {
    const rows = payload.tables[t];
    if (!Array.isArray(rows) || rows.length === 0) {
      counts[t] = 0;
      continue;
    }
    try {
      counts[t] = await insertRows(t, rows);
    } catch {
      // Missing table on a pre-migration dev DB — skip rather than abort.
      counts[t] = 0;
    }
  }

  // 3. Derived data: clear the search index and invalidate the lazy-backfill
  //    state so the next search re-indexes exactly what was imported (see
  //    src/server/search.ts). Clearing here also covers empty imports, where
  //    the lazy backfill would otherwise skip rebuilding entirely.
  await run("DELETE FROM search_index").catch(() => undefined);
  await invalidateSearchIndex();

  return counts;
}

// ── Snapshot storage ───────────────────────────────────────────────

async function pruneSnapshots(keep: number): Promise<number> {
  const cap = Number.isFinite(keep) && keep > 0 ? Math.min(Math.floor(keep), 100) : 10;
  const stale = await query<{ id: number }>(
    `SELECT id FROM backups ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?`,
    [cap],
  ).catch(() => [] as { id: number }[]);
  let pruned = 0;
  for (const row of stale) {
    await run("DELETE FROM backups WHERE id = ?", [row.id]).catch(() => undefined);
    pruned += 1;
  }
  return pruned;
}

/**
 * Create a snapshot row. `kind`/`trigger` describe why it exists; the payload
 * is the same portable format used for file exports, so any snapshot can be
 * downloaded, restored later, or pushed to Google Drive by the caller.
 */
export async function createSnapshot(
  kind: "auto" | "manual",
  trigger: "timer" | "user" | "pre-import" | "pre-restore",
  keep: number,
): Promise<{ snapshot: BackupSummary; pruned: number; payload: BackupPayload }> {
  const payload = await dumpAllData();
  const json = JSON.stringify(payload);
  const counts = tableRowCounts(payload);

  const result = await run(
    `INSERT INTO backups (kind, trigger, payload, table_counts, size_bytes) VALUES (?, ?, ?, ?, ?)`,
    [kind, trigger, json, JSON.stringify(counts), json.length],
  );
  const pruned = await pruneSnapshots(keep);
  const row = await get<BackupSummary>(
    "SELECT id, kind, trigger, table_counts, size_bytes, created_at FROM backups WHERE id = ?",
    [result.lastInsertRowid],
  );
  const snapshot = {
    ...row,
    table_counts: row?.table_counts ? JSON.parse(row.table_counts as unknown as string) : null,
  } as BackupSummary;
  return { snapshot, pruned, payload };
}

export async function listSnapshots(limit = 50): Promise<BackupSummary[]> {
  const rows = await query<{ id: number; kind: string; trigger: string; table_counts: string | null; size_bytes: number | null; created_at: string }>(
    `SELECT id, kind, trigger, table_counts, size_bytes, created_at
     FROM backups
     ORDER BY created_at DESC, id DESC LIMIT ?`,
    [Math.min(Math.max(limit, 1), 100)],
  ).catch(() => []);
  return rows.map((r) => ({
    ...r,
    table_counts: r.table_counts ? (JSON.parse(r.table_counts) as Record<string, number>) : null,
  }));
}

/** Full payload of one snapshot, for download or restore. Returns null if missing. */
export async function getSnapshotPayload(id: number): Promise<BackupPayload | null> {
  const row = await get<{ payload: string }>("SELECT payload FROM backups WHERE id = ?", [id]);
  if (!row) return null;
  try {
    return JSON.parse(row.payload) as BackupPayload;
  } catch {
    return null;
  }
}

export async function deleteSnapshot(id: number): Promise<boolean> {
  const r = await run("DELETE FROM backups WHERE id = ?", [id]);
  return r.changes > 0;
}

/** Total snapshot storage footprint, for the settings UI. */
export async function snapshotsStats(): Promise<{ count: number; total_bytes: number; last_at: string | null }> {
  const row = await get<{ count: number; total_bytes: number; last_at: string | null }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(size_bytes), 0) AS total_bytes,
            MAX(created_at) AS last_at
     FROM backups`,
  ).catch(() => ({ count: 0, total_bytes: 0, last_at: null }));
  return row ?? { count: 0, total_bytes: 0, last_at: null };
}
