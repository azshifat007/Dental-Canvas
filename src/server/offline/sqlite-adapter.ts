/**
 * A D1-shaped SQLite database backed by sql.js (WebAssembly SQLite), persisted
 * to IndexedDB.
 *
 * This is the storage engine for OFFLINE mode: the real Hono server
 * (`src/server/index.ts`) runs inside a service worker with this adapter as
 * its `DB` binding, so the desktop app talks to exactly the code that serves
 * the Cloudflare deployment — same endpoints, same validation, same SQL.
 *
 * D1 shape implemented here (only what @clawnify/db's d1Impl touches):
 *   prepare(sql).bind(...params) → { run(), all<T>(), first<T>() }
 *   exec(sql)
 *   batch(stmts)
 *
 * Persistence: the whole database image is exported and stored in IndexedDB
 * after each mutation batch, debounced. On startup the saved image (if any) is
 * imported; otherwise the caller applies schema.sql to a fresh database.
 *
 * FTS5 note: sql.js ships FTS4, not FTS5. The schema's `search_index` virtual
 * table is translated to fts4 on this engine — the porter/unicode61 tokenizer
 * options are dropped (fts4 default tokenizer applies) and the server's
 * `searchAll` already falls back to LIKE when MATCH fails, so degraded search
 * remains functional offline.
 */

import initSqlJs, { type SqlJsStatic } from "sql.js";

/** Minimal D1 shapes — matches @cloudflare/workers-types but self-contained
 * so the adapter also typechecks under the DOM lib set in sw context. */
interface D1Meta {
  changes?: number;
  last_row_id?: number;
  duration?: number;
  rows_read?: number;
  rows_written?: number;
}
interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1Meta;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}
export interface D1LikeDatabase {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<D1Result>;
  batch(stmts: D1PreparedStatement[]): Promise<D1Result[]>;
}

// ── Constants ──────────────────────────────────────────────────────

const IDB_NAME = "dental-canvas-offline";
const IDB_STORE = "db-image";
const IDB_KEY = "sqlite";
/** Debounce for post-write persistence. Writes inside this window coalesce. */
const PERSIST_DEBOUNCE_MS = 400;

// ── Schema translation ─────────────────────────────────────────────

/**
 * Adapt schema.sql for the sql.js engine:
 * 1. fts5 virtual tables → fts4 (tokenizer options dropped).
 * 2. Statement splitting — sql.js's exec() runs one statement at a time.
 */
export function splitStatements(sqlText: string): string[] {
  const noComments = sqlText
    .split("\n")
    .filter((line) => !/^[ \t]*--/.test(line))
    .join("\n");
  const stmts: string[] = [];
  let cur = "";
  let inTrigger = false;
  for (const ch of noComments) {
    cur += ch;
    if (ch !== ";") continue;
    const body = cur.slice(0, -1).trimEnd();
    if (!inTrigger) {
      if (/^\s*CREATE\s+TRIGGER/i.test(body)) {
        inTrigger = true;
        continue;
      }
      stmts.push(cur.trim());
      cur = "";
    } else if (/\bEND$/i.test(body)) {
      stmts.push(cur.trim());
      cur = "";
      inTrigger = false;
    }
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts.filter((s) => s.length > 0);
}

export function adaptSchemaForSqlJs(sqlText: string): string {
  return sqlText.replace(
    /USING\s+fts5\s*\(([^;]*?)\)/gis,
    (_m, cols: string) => {
      // Drop trailing tokenizer options (tokenize = '...') — fts4 rejects them.
      const cleaned = cols.replace(/,\s*tokenize\s*=\s*[^,)]+/gi, "");
      return `USING fts4(${cleaned})`;
    },
  );
}

// ── IndexedDB persistence ──────────────────────────────────────────

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

async function idbGet(db: IDBDatabase, key: string): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as Uint8Array | undefined);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB get failed"));
  });
}

async function idbPut(db: IDBDatabase, key: string, value: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB put failed"));
  });
}

// ── The adapter ────────────────────────────────────────────────────

interface SqlJsBinding {
  bind(...values: unknown[]): SqlJsBinding;
  run: () => Promise<D1Result>;
  all: <T = Record<string, unknown>>() => Promise<D1Result<T>>;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
}

/** Convert a JS value into a sql.js-bindable one (blobs stay binary). */
function toBindValue(v: unknown): string | number | bigint | Uint8Array | null {
  if (v === null || v === undefined) return null;
  const t = typeof v;
  if (t === "string" || t === "number" || t === "bigint") return v as string | number | bigint;
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (v instanceof Date) return v.toISOString();
  if (t === "boolean") return v ? 1 : 0;
  // sql.js cannot bind objects/arrays — JSON is the last resort (server code
  // binds JSON via the json() helper already; this is a safety net).
  return JSON.stringify(v);
}

/** Materialize a sql.js result row as a plain object with D1-style values. */
function rowToObject(cols: string[], values: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < cols.length; i++) {
    const v = values[i];
    // BLOB columns come back as Uint8Array — expose ArrayBuffer like D1 does.
    out[cols[i]] = v instanceof Uint8Array ? v.slice().buffer : v;
  }
  return out;
}

export interface OfflineAdapterOptions {
  /** schema.sql text, applied only when no saved database image exists. */
  schemaSql: string;
  /** Called after every persisted save (UI badge, last-saved display). */
  onSaved?: () => void;
  /**
   * Persistence override for tests / non-UI contexts. Default: IndexedDB.
   * `load` returns the previous image (or undefined for a fresh install);
   * `save` receives every exported image.
   */
  persistence?: {
    load: () => Promise<Uint8Array | undefined>;
    save: (image: Uint8Array) => Promise<void>;
  };
}

export async function createOfflineD1(opts: OfflineAdapterOptions): Promise<D1LikeDatabase> {
  // sql-wasm.js fetches its wasm binary from locateFile(). The build copies
  // sql-wasm.wasm next to sw.js and the SW precaches it, so the fetch is
  // answered from cache with zero network. Under Node (tests) there is no
  // "/"-rooted fetch — resolve the file from the package instead.
  const SQL: SqlJsStatic = await initSqlJs(
    typeof process !== "undefined" && process.versions?.node
      ? { locateFile: (f) => new URL(`../../../node_modules/sql.js/dist/${f}`, import.meta.url).toString() }
      : { locateFile: () => "/sql-wasm.wasm" },
  );

  const store = opts.persistence ?? {
    load: async () => {
      const idb = await idbOpen();
      return idbGet(idb, IDB_KEY);
    },
    save: async (image: Uint8Array) => {
      const idb = await idbOpen();
      await idbPut(idb, IDB_KEY, image);
    },
  };

  const saved = await store.load();
  const db = saved
    ? new SQL.Database(saved)
    : new SQL.Database();

  // ── Persistence ──────────────────────────────────────────────
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let persistChain: Promise<void> = Promise.resolve();

  if (!saved) {
    // Fresh install: apply the translated schema.
    for (const stmt of splitStatements(adaptSchemaForSqlJs(opts.schemaSql))) {
      db.run(stmt);
    }
    schedulePersist();
  }

  function schedulePersist(): void {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistChain = persistChain.then(async () => {
        try {
          const image = db.export();
          await store.save(image);
          opts.onSaved?.();
        } catch {
          // Persistence failure must not break the request path; the next
          // write retries.
        }
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  /** Wrap every mutating statement with a persistence schedule. */
  const MUTATION_RE = /^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|REINDEX)/i;

  function trackSql(sql: string): void {
    if (MUTATION_RE.test(sql)) schedulePersist();
  }

  // ── D1 shape ─────────────────────────────────────────────────
  class Prepared implements SqlJsBinding {
    constructor(
      private sql: string,
      private params: unknown[] = [],
    ) {}

    /** D1's chainable parameter binder — returns a new prepared statement. */
    bind(...values: unknown[]): Prepared {
      const next = new Prepared(this.sql, values);
      return next;
    }

    private execRows(): { cols: string[]; rows: unknown[][] } {
      const stmt = db.prepare(this.sql);
      try {
        if (this.params.length) {
          stmt.bind(this.params.map(toBindValue) as never);
        }
        const cols = stmt.getColumnNames();
        const rows: unknown[][] = [];
        while (stmt.step()) rows.push(stmt.get());
        return { cols, rows };
      } finally {
        stmt.free();
      }
    }

    async run(): Promise<D1Result> {
      trackSql(this.sql);
      const { cols, rows } = this.execRows();
      const changes = db.getRowsModified();
      // last_insert_rowid needs a query — do it while we're here.
      let lastInsertRowid = 0;
      if (/^\s*(INSERT|REPLACE)/i.test(this.sql)) {
        const r = db.exec("SELECT last_insert_rowid()");
        lastInsertRowid = Number(r[0]?.values?.[0]?.[0] ?? 0);
      }
      return {
        success: true,
        meta: {
          changes,
          last_row_id: lastInsertRowid,
          duration: 0,
          rows_read: rows.length,
          rows_written: changes,
        },
        // D1's run() carries no rows; keep cols for compatibility.
        results: rows.map((v) => rowToObject(cols, v)) as never,
      };
    }

    async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
      const { cols, rows } = this.execRows();
      return {
        success: true,
        meta: { duration: 0, rows_read: rows.length, rows_written: 0 },
        results: rows.map((v) => rowToObject(cols, v)) as T[],
      };
    }

    async first<T = Record<string, unknown>>(): Promise<T | null> {
      const stmt = db.prepare(this.sql);
      try {
        if (this.params.length) {
          stmt.bind(this.params.map(toBindValue) as never);
        }
        const cols = stmt.getColumnNames();
        if (stmt.step()) return rowToObject(cols, stmt.get()) as T;
        return null;
      } finally {
        stmt.free();
      }
    }
  }

  const d1 = {
    prepare(sql: string): SqlJsBinding {
      return new Prepared(sql);
    },
    async exec(rawSql: string): Promise<D1Result> {
      const stmts = splitStatements(rawSql);
      let rowsRead = 0;
      for (const s of stmts) {
        trackSql(s);
        const r = db.exec(s);
        for (const res of r) rowsRead += res.values.length;
      }
      return {
        success: true,
        meta: { duration: 0, rows_read: rowsRead, rows_written: 0 },
        results: [],
      };
    },
    async batch(stmts: SqlJsBinding[]): Promise<D1Result[]> {
      const out: D1Result[] = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    async withSession<T>(_cb: (session: unknown) => Promise<T>): Promise<T> {
      throw new Error("Sessions are not supported in offline mode");
    },
  } as unknown as D1LikeDatabase;

  return d1;
}

