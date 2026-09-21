import { type Context } from "hono";
import { z } from "zod";
import { createApp } from "@clawnify/app";
import { query, get, run } from "./db";
import {
  DEFAULT_BACKUP_SETTINGS,
  DEFAULT_INVENTORY_SETTINGS,
  DEFAULT_PROFILE_SETTINGS,
  DEFAULT_SETTINGS,
  DEFAULT_STORAGE_SETTINGS,
  MEDICINES_PRESETS_VERSION,
  SEED_DENTIST_NOTES,
  SEED_INVENTORY,
  SEED_MEDICINES,
  SEED_OPERATORIES,
  SEED_PRACTITIONERS,
  SEED_TREATMENT_TYPES,
} from "./seed";
import { reindexSearchIndex, searchAll } from "./search";
import {
  getInventorySettings,
  INVENTORY_CATEGORIES,
  runInventoryScan,
  type InventoryItemRow,
} from "./inventory";
import {
  createSnapshot,
  deleteSnapshot,
  dumpAllData,
  getSnapshotPayload,
  listSnapshots,
  restoreFromBackup,
  snapshotsStats,
  validateBackupPayload,
  isPayloadTooLarge,
  countRows,
  type BackupPayload,
} from "./backup";
import {
  IMAGE_KINDS,
  IMAGE_MIME_TYPES,
  DB_STORAGE_MAX_MB,
  isDbStorage,
  isStorageConfigured,
  newObjectKey,
  presignUpload,
  readStorageSettings,
  storageStatus,
  storageUrlForFile,
  validateStorageInput,
} from "./storage";

type Env = { Bindings: { DB: D1Database } };

const app = createApp<Env>({
  title: "Dental Canvas",
  version: "1.0.0",
  description: "Dental practice management: patients, appointments, operatories, treatments, and billing.",
});

// ── First-run seed ─────────────────────────────────────────────────
// `schema.sql` is applied as DDL only by the Clawnify deploy pipeline, so the
// practice defaults and the sample rows are inserted here, on the first request
// that reaches the app, instead of from the schema file.

type SeedTable = "operatories" | "practitioners" | "treatment_types" | "dentist_notes" | "medicines" | "inventory_items";

let seeded = false;
let seeding: Promise<void> | null = null;

async function isEmpty(table: SeedTable): Promise<boolean> {
  const row = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return (row?.n ?? 0) === 0;
}

async function seedOnce(): Promise<void> {
  for (const [key, value] of Object.entries({
    ...DEFAULT_SETTINGS,
    ...DEFAULT_PROFILE_SETTINGS,
    ...DEFAULT_BACKUP_SETTINGS,
    ...DEFAULT_INVENTORY_SETTINGS,
    ...DEFAULT_STORAGE_SETTINGS,
  })) {
    await run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value]);
  }

  // Sample rows land only while the table is still empty, so a redeploy never
  // resurrects an operatory, practitioner or treatment type the user deleted.
  if (await isEmpty("operatories")) {
    for (const o of SEED_OPERATORIES) {
      await run("INSERT INTO operatories (name, color, sort_order) VALUES (?, ?, ?)", [o.name, o.color, o.sort_order]);
    }
  }

  if (await isEmpty("practitioners")) {
    for (const p of SEED_PRACTITIONERS) {
      await run("INSERT INTO practitioners (name, role, color) VALUES (?, ?, ?)", [p.name, p.role, p.color]);
    }
  }

  if (await isEmpty("treatment_types")) {
    for (const t of SEED_TREATMENT_TYPES) {
      await run(
        "INSERT INTO treatment_types (code, name, duration_minutes, default_fee, color) VALUES (?, ?, ?, ?, ?)",
        [t.code, t.name, t.duration_minutes, t.default_fee, t.color],
      );
    }
  }

  if (await isEmpty("dentist_notes")) {
    for (const n of SEED_DENTIST_NOTES) {
      await run("INSERT INTO dentist_notes (body) VALUES (?)", [n.body]);
    }
  }

  if (await isEmpty("medicines")) {
    for (const m of SEED_MEDICINES) {
      await run(
        "INSERT INTO medicines (name, drug_group, dosage, frequency, duration, instructions) VALUES (?, ?, ?, ?, ?, ?)",
        [m.name, m.drug_group, m.dosage, m.frequency, m.duration, m.instructions],
      );
    }
  } else {
    // The built-in preset list gains entries over time. When it ships a new
    // version, add just the missing names (INSERT OR IGNORE keyed on the name
    // unique index) without touching the user's edits to existing medicines or
    // undoing a medicine they deliberately deleted.
    const cur = await get<{ value: string }>("SELECT value FROM settings WHERE key = 'medicines_presets_version'");
    if ((cur?.value ?? "") !== MEDICINES_PRESETS_VERSION) {
      for (const m of SEED_MEDICINES) {
        await run(
          "INSERT OR IGNORE INTO medicines (name, drug_group, dosage, frequency, duration, instructions) VALUES (?, ?, ?, ?, ?, ?)",
          [m.name, m.drug_group, m.dosage, m.frequency, m.duration, m.instructions],
        );
      }
      await run("INSERT OR REPLACE INTO settings (key, value) VALUES ('medicines_presets_version', ?)", [
        MEDICINES_PRESETS_VERSION,
      ]);
    }
  }

  // Starter dental-supply stock. Expiry dates are rolled relative to the
  // first-run date so the expiring/expired alerts surface right away.
  if (await isEmpty("inventory_items")) {
    for (const it of SEED_INVENTORY) {
      await run(
        `INSERT INTO inventory_items
           (name, category, sku, unit, current_stock, min_threshold, reorder_quantity,
            supplier_name, supplier_contact, batch_number, expiry_date, location, unit_cost, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE date('now', '+' || ? || ' days') END, ?, ?, ?)`,
        [
          it.name, it.category, it.sku, it.unit, it.current_stock, it.min_threshold, it.reorder_quantity,
          it.supplier_name, it.supplier_contact, it.batch_number,
          it.expiry_offset_days, it.expiry_offset_days, it.location, it.unit_cost, it.notes,
        ],
      );
    }
  }
}

async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  try {
    // Concurrent first requests share one run — the app shell fires four API
    // calls in parallel on load, and without this each would read COUNT(*) = 0
    // and insert its own copy of the sample rows.
    // shortcut: the shared promise is per-isolate; if duplicates ever show up on
    // a cold app, claim the seed atomically with an `INSERT OR IGNORE` marker row.
    seeding ??= seedOnce();
    await seeding;
    seeded = true;
  } catch {
    // Sample data must never fail a request.
    seeded = false;
    seeding = null;
  }
}

/**
 * Runtime column migrations for databases created before a schema change.
 * schema.sql only runs as DDL on fresh databases (CREATE TABLE IF NOT EXISTS),
 * so columns added later must be added with ALTER TABLE here. Idempotent and
 * failure-tolerant: a partially-migrated DB must never fail a request.
 */
async function ensureColumnMigrations(): Promise<void> {
  try {
    const cols = await query<{ name: string }>("PRAGMA table_info(prescriptions)");
    const names = new Set(cols.map((c) => c.name));
    if (!names.has("large_print")) {
      await run("ALTER TABLE prescriptions ADD COLUMN large_print INTEGER NOT NULL DEFAULT 0");
    }
    if (!names.has("tooth")) {
      await run("ALTER TABLE prescriptions ADD COLUMN tooth TEXT");
    }
    // Nullable FK: legal in ALTER TABLE because the default is NULL. The plan
    // link is informational (ON DELETE SET NULL) — deleting a plan item must
    // never take a prescription with it.
    if (!names.has("plan_item_id")) {
      await run(
        "ALTER TABLE prescriptions ADD COLUMN plan_item_id INTEGER REFERENCES treatment_plan_items(id) ON DELETE SET NULL",
      );
    }
    // Databases created before the chamber template kept the old column
    // default; new rows should default to the chamber pad.
    const dflt = await query<{ dflt_value: string | null }>(
      "SELECT dflt_value FROM pragma_table_info('prescriptions') WHERE name = 'template'",
    );
    if (dflt[0]?.dflt_value && !dflt[0].dflt_value.includes("chamber")) {
      await run("ALTER TABLE prescriptions ALTER COLUMN template SET DEFAULT 'chamber'");
    }
    // Attached image ids (JSON array of patient_images rows) shown on the
    // printed sheet, e.g. the x-ray images associated with this prescription.
    if (!names.has("image_ids")) {
      await run("ALTER TABLE prescriptions ADD COLUMN image_ids TEXT");
    }
    // Databases created before the image module existed need the table.
    await run(`CREATE TABLE IF NOT EXISTS patient_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
      appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
      file_key TEXT NOT NULL UNIQUE,
      file_name TEXT,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'photo',
      label TEXT,
      compare_group TEXT,
      uploaded_by INTEGER REFERENCES practitioners(id) ON DELETE SET NULL,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted INTEGER NOT NULL DEFAULT 0
    )`);
    await run("CREATE INDEX IF NOT EXISTS idx_img_patient ON patient_images(patient_id, deleted, uploaded_at DESC)");
    await run("CREATE INDEX IF NOT EXISTS idx_img_appointment ON patient_images(appointment_id)");
    await run("CREATE INDEX IF NOT EXISTS idx_img_compare ON patient_images(patient_id, compare_group)");
    // Byte payloads for the built-in DB storage tier (the default provider).
    // No FK to patient_images — bytes are written before metadata is registered.
    await run(`CREATE TABLE IF NOT EXISTS patient_image_blobs (
      file_key TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    // Databases created before the medicine list existed need the table.
    await run(`CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      drug_group TEXT,
      dosage TEXT,
      frequency TEXT,
      duration TEXT,
      instructions TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_medicines_name ON medicines (name)");
    // Databases created before the inventory module existed need the tables.
    await run(`CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      sku TEXT,
      unit TEXT NOT NULL DEFAULT 'piece',
      current_stock INTEGER NOT NULL DEFAULT 0,
      min_threshold INTEGER NOT NULL DEFAULT 0,
      reorder_quantity INTEGER,
      supplier_name TEXT,
      supplier_contact TEXT,
      batch_number TEXT,
      expiry_date TEXT,
      location TEXT,
      unit_cost REAL NOT NULL DEFAULT 0,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await run(`CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      unit_cost REAL,
      reference TEXT,
      reason TEXT,
      notes TEXT,
      performed_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    await run(`CREATE TABLE IF NOT EXISTS inventory_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      resolved INTEGER NOT NULL DEFAULT 0,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } catch {
    // Table missing (fresh DB pre-DDL) or PRAGMA unsupported — schema.sql will
    // create the table with the column when it runs.
  }
}

let migrated = false;
let migrating: Promise<void> | null = null;

async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  migrating ??= ensureColumnMigrations()
    .then(() => {
      migrated = true;
    })
    .catch(() => {
      migrating = null; // retry on the next request
    });
  await migrating;
}

app.use("*", async (_c, next) => {
  await ensureSeeded();
  await ensureMigrated();
  await next();
});

// ── Helpers ────────────────────────────────────────────────────────

const intParam = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

/** 'YYYY-MM-DD' plus N days (used for the expiry alert window). */
function datePlusDays(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function parseJson<T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, data: parsed.data };
}

// ── Operatories ────────────────────────────────────────────────────

const OperatoryInput = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
  sort_order: z.number().int().optional(),
});

app.get("/api/operatories", async (c) => {
  const rows = await query("SELECT * FROM operatories ORDER BY sort_order, id");
  return c.json({ operatories: rows });
});

app.post("/api/operatories", async (c) => {
  const parsed = await parseJson(c, OperatoryInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { name, color, sort_order } = parsed.data;
  const result = await run(
    "INSERT INTO operatories (name, color, sort_order) VALUES (?, ?, COALESCE(?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM operatories)))",
    [name, color ?? "sky", sort_order ?? null],
  );
  const row = await get("SELECT * FROM operatories WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ operatory: row }, 201);
});

app.put("/api/operatories/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, OperatoryInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const fields = parsed.data;
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE operatories SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM operatories WHERE id = ?", [id]);
  return c.json({ operatory: row });
});

app.delete("/api/operatories/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM operatories WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Practitioners ──────────────────────────────────────────────────

const PractitionerInput = z.object({
  name: z.string().min(1),
  role: z.enum(["dentist", "hygienist", "assistant"]).optional(),
  color: z.string().optional(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
});

app.get("/api/practitioners", async (c) => {
  const rows = await query("SELECT * FROM practitioners ORDER BY name");
  return c.json({ practitioners: rows });
});

app.post("/api/practitioners", async (c) => {
  const parsed = await parseJson(c, PractitionerInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { name, role, color, email, phone } = parsed.data;
  const result = await run(
    "INSERT INTO practitioners (name, role, color, email, phone) VALUES (?, ?, ?, ?, ?)",
    [name, role ?? "dentist", color ?? "teal", email ?? null, phone ?? null],
  );
  const row = await get("SELECT * FROM practitioners WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ practitioner: row }, 201);
});

app.put("/api/practitioners/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, PractitionerInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE practitioners SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM practitioners WHERE id = ?", [id]);
  return c.json({ practitioner: row });
});

app.delete("/api/practitioners/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM practitioners WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Treatment types ────────────────────────────────────────────────

const TreatmentTypeInput = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  duration_minutes: z.number().int().min(5).optional(),
  default_fee: z.number().min(0).optional(),
  color: z.string().optional(),
});

app.get("/api/treatment-types", async (c) => {
  const rows = await query("SELECT * FROM treatment_types ORDER BY code");
  return c.json({ treatment_types: rows });
});

app.post("/api/treatment-types", async (c) => {
  const parsed = await parseJson(c, TreatmentTypeInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { code, name, duration_minutes, default_fee, color } = parsed.data;
  const result = await run(
    "INSERT INTO treatment_types (code, name, duration_minutes, default_fee, color) VALUES (?, ?, ?, ?, ?)",
    [code, name, duration_minutes ?? 30, default_fee ?? 0, color ?? "sky"],
  );
  const row = await get("SELECT * FROM treatment_types WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ treatment_type: row }, 201);
});

app.put("/api/treatment-types/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, TreatmentTypeInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE treatment_types SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM treatment_types WHERE id = ?", [id]);
  return c.json({ treatment_type: row });
});

app.delete("/api/treatment-types/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM treatment_types WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Medicines (editable practice list → prescription autocomplete) ──

const MedicineInput = z.object({
  name: z.string().min(1),
  drug_group: z.string().optional(),
  dosage: z.string().optional(),
  frequency: z.string().optional(),
  duration: z.string().optional(),
  instructions: z.string().optional(),
});

app.get("/api/medicines", async (c) => {
  const rows = await query("SELECT * FROM medicines ORDER BY name COLLATE NOCASE");
  return c.json({ medicines: rows });
});

app.post("/api/medicines", async (c) => {
  const parsed = await parseJson(c, MedicineInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { name, drug_group, dosage, frequency, duration, instructions } = parsed.data;
  const existing = await get("SELECT id FROM medicines WHERE name = ? COLLATE NOCASE", [name.trim()]);
  if (existing) return c.json({ error: `“${name.trim()}” is already in your medicine list.` }, 409);
  const result = await run(
    "INSERT INTO medicines (name, drug_group, dosage, frequency, duration, instructions) VALUES (?, ?, ?, ?, ?, ?)",
    [name.trim(), drug_group?.trim() || null, dosage?.trim() || null, frequency?.trim() || null, duration?.trim() || null, instructions?.trim() || null],
  );
  const row = await get("SELECT * FROM medicines WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ medicine: row }, 201);
});

app.put("/api/medicines/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, MedicineInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(typeof v === "string" && v.trim() === "" ? null : v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE medicines SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM medicines WHERE id = ?", [id]);
  return c.json({ medicine: row });
});

app.delete("/api/medicines/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM medicines WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Patients ───────────────────────────────────────────────────────

const PatientInput = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  date_of_birth: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  medical_alerts: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  referral_source: z.string().optional().nullable(),
});

app.get("/api/patients", async (c) => {
  const search = c.req.query("q")?.trim();
  if (search) {
    // A query of 7+ digits is treated as a phone search and matched against
    // the *normalized* phone (punctuation stripped), so "5550100111" finds
    // "(555) 010-0111". Short queries use plain LIKE matching.
    const digits = search.replace(/\D/g, "");
    if (digits.length >= 7) {
      const rows = await query(
        "SELECT * FROM patients WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '(', ''), ')', ''), '-', '') LIKE ? ORDER BY last_name, first_name LIMIT 200",
        [`%${digits}%`],
      );
      // Also match plain LIKE so names that happen to be digits still surface.
      const like = `%${search}%`;
      const extra = await query(
        "SELECT * FROM patients WHERE (last_name LIKE ? OR first_name LIKE ? OR email LIKE ? OR phone LIKE ?) ORDER BY last_name, first_name LIMIT 200",
        [like, like, like, like],
      );
      const merged = [...rows, ...extra.filter((e) => !rows.some((r) => r.id === e.id))];
      return c.json({ patients: merged });
    }
    const like = `%${search}%`;
    const rows = await query(
      "SELECT * FROM patients WHERE last_name LIKE ? OR first_name LIKE ? OR email LIKE ? OR phone LIKE ? ORDER BY last_name, first_name LIMIT 200",
      [like, like, like, like],
    );
    return c.json({ patients: rows });
  }
  const rows = await query("SELECT * FROM patients ORDER BY last_name, first_name LIMIT 500");
  return c.json({ patients: rows });
});

app.get("/api/patients/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get("SELECT * FROM patients WHERE id = ?", [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ patient: row });
});

app.post("/api/patients", async (c) => {
  const parsed = await parseJson(c, PatientInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    "INSERT INTO patients (first_name, last_name, date_of_birth, email, phone, address, medical_alerts, notes, referral_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [d.first_name, d.last_name, d.date_of_birth ?? null, d.email ?? null, d.phone ?? null, d.address ?? null, d.medical_alerts ?? null, d.notes ?? null, d.referral_source ?? null],
  );
  const row = await get("SELECT * FROM patients WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ patient: row }, 201);
});

app.put("/api/patients/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, PatientInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE patients SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM patients WHERE id = ?", [id]);
  return c.json({ patient: row });
});

app.delete("/api/patients/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM patients WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Prescriptions ──────────────────────────────────────────────────

const PrescriptionInput = z.object({
  patient_id: z.number().int(),
  practitioner_id: z.number().int().nullable().optional(),
  issued_date: z.string().optional().nullable(),
  template: z.enum(["chamber", "classic", "modern", "compact", "elegant", "minimal", "bold", "watermark"]).optional(),
  large_print: z.boolean().optional(),
  tooth: z.string().max(32).optional().nullable(),
  plan_item_id: z.number().int().nullable().optional(),
  diagnosis: z.string().optional().nullable(),
  advice: z.string().optional().nullable(),
  follow_up: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        drug_name: z.string().min(1),
        dosage: z.string().optional().nullable(),
        frequency: z.string().optional().nullable(),
        duration: z.string().optional().nullable(),
        instructions: z.string().optional().nullable(),
      }),
    )
    .min(1),
  // patient_images rows to show on the printed sheet (x-rays etc).
  image_ids: z.array(z.number().int()).max(12).optional(),
});

const PrescriptionUpdateInput = PrescriptionInput.partial().extend({
  items: z
    .array(
      z.object({
        drug_name: z.string().min(1),
        dosage: z.string().optional().nullable(),
        frequency: z.string().optional().nullable(),
        duration: z.string().optional().nullable(),
        instructions: z.string().optional().nullable(),
      }),
    )
    .optional(),
});

/** A logo must be a small image/* data URL — anything else is refused. */
function isSafeLogoDataUrl(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.startsWith("data:image/") &&
    v.length <= 400_000 &&
    !v.includes("<") &&
    !v.includes(">")
  );
}

async function loadPrescription(id: number) {
  const rx = await get(`
    SELECT rx.*, pr.name as practitioner_name, pr.role as practitioner_role,
           p.first_name as patient_first_name, p.last_name as patient_last_name,
           p.date_of_birth as patient_date_of_birth, p.medical_alerts as patient_medical_alerts,
           p.email as patient_email, p.phone as patient_phone,
           tt.name as plan_treatment_name, tt.code as plan_treatment_code
    FROM prescriptions rx
    LEFT JOIN practitioners pr ON pr.id = rx.practitioner_id
    LEFT JOIN patients p ON p.id = rx.patient_id
    LEFT JOIN treatment_plan_items tpi ON tpi.id = rx.plan_item_id
    LEFT JOIN treatment_types tt ON tt.id = tpi.treatment_type_id
    WHERE rx.id = ?
  `, [id]);
  if (!rx) return null;
  const items = await query(
    "SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order, id",
    [id],
  );
  const imageIds = parseImageIds(rx.image_ids);
  const images = imageIds.length ? await resolveImageRows(imageIds) : [];
  return { ...rx, image_ids: imageIds.length ? imageIds : null, items, images };
}

app.get("/api/patients/:id/prescriptions", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rows = await query(
    `SELECT rx.*, pr.name as practitioner_name,
            tt.name as plan_treatment_name,
            (SELECT COUNT(*) FROM prescription_items ri WHERE ri.prescription_id = rx.id) as item_count
     FROM prescriptions rx
     LEFT JOIN practitioners pr ON pr.id = rx.practitioner_id
     LEFT JOIN treatment_plan_items tpi ON tpi.id = rx.plan_item_id
     LEFT JOIN treatment_types tt ON tt.id = tpi.treatment_type_id
     WHERE rx.patient_id = ?
     ORDER BY rx.issued_date DESC, rx.id DESC`,
    [id],
  );
  return c.json({ prescriptions: rows.map((r) => ({ ...r, image_ids: parseImageIds(r.image_ids) })) });
});

app.get("/api/prescriptions/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rx = await loadPrescription(id);
  if (!rx) return c.json({ error: "Not found" }, 404);
  return c.json({ prescription: rx });
});

/** Strip HTML-sensitive characters from interpolated email text. */
function escapeEmailHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch] ?? ch);
}

/**
 * Email a prescription PDF to the patient. The PDF is rasterized in the
 * browser (the sheet is client-side markup), posted here as base64, and
 * relayed through the Resend API using the practice's configured key —
 * the key never reaches the browser. Defaults to the patient record's
 * email; the request may override the recipient.
 */
app.post("/api/prescriptions/:id/email", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  let body: Record<string, unknown>;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }

  const rx = await loadPrescription(id);
  if (!rx) return c.json({ error: "Not found" }, 404);
  const row = rx as unknown as Record<string, unknown>;

  const settingsRows = await query<{ key: string; value: string }>("SELECT key, value FROM settings").catch(() => []);
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  const apiKey = (settings.email_api_key ?? "").trim();
  const from = (settings.email_from ?? "").trim();
  if (!apiKey || !from) {
    return c.json({ error: "Email is not configured yet. Add a Resend API key and from address in Settings → Email." }, 400);
  }

  const to = typeof body.to === "string" && body.to.trim() ? body.to.trim() : typeof row.patient_email === "string" ? row.patient_email : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return c.json({ error: "This patient has no email address on file. Add one to the patient record first." }, 400);
  }

  const rawPdf = typeof body.pdf_base64 === "string" ? body.pdf_base64.trim() : "";
  const base64 = rawPdf.includes(",") ? rawPdf.slice(rawPdf.indexOf(",") + 1) : rawPdf;
  if (!base64 || !/^[A-Za-z0-9+/=\r\n]+$/.test(base64.slice(0, 512))) {
    return c.json({ error: "A generated PDF is required to send." }, 400);
  }
  if (base64.length > 10 * 1024 * 1024) {
    return c.json({ error: "The PDF is too large to email." }, 413);
  }

  const clinicName = (settings.clinic_name ?? "").trim();
  const doctorName = (settings.doctor_name ?? "").trim();
  const practiceLabel = clinicName || doctorName || "Dental Canvas";
  const patientFirst = typeof row.patient_first_name === "string" ? row.patient_first_name.trim() : "";
  const issuedDate = typeof row.issued_date === "string" ? row.issued_date : "";
  const note = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : "";

  const subject = `Prescription from ${practiceLabel} — ${issuedDate}`;
  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
      <h2 style="margin:0 0 4px;color:#166534">${escapeEmailHtml(practiceLabel)}</h2>
      <p style="margin:0 0 16px;color:#6b7280;font-size:13px">Prescription dated ${escapeEmailHtml(issuedDate)}</p>
      <p style="margin:0 0 8px">Hello ${escapeEmailHtml(patientFirst || "there")},</p>
      ${note ? `<p style="margin:0 0 8px;white-space:pre-line">${escapeEmailHtml(note)}</p>` : ""}
      <p style="margin:0 0 8px">Your prescription is attached as a PDF. Please follow the dosage and instructions it contains, and contact the practice with any questions.</p>
      ${doctorName ? `<p style="margin:16px 0 0">— ${escapeEmailHtml(doctorName)}${clinicName ? `, ${escapeEmailHtml(clinicName)}` : ""}</p>` : ""}
    </div>`;

  let providerRes: Response;
  try {
    providerRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        attachments: [{
          filename: typeof body.filename === "string" && body.filename.trim() ? body.filename.trim() : "prescription.pdf",
          content: base64,
        }],
      }),
    });
  } catch (err) {
    return c.json({ error: `Could not reach the email provider: ${(err as Error).message}` }, 502);
  }
  if (!providerRes.ok) {
    const detail = await providerRes.text().catch(() => "");
    return c.json({ error: `The email provider rejected the message (${providerRes.status}). ${detail.slice(0, 300)}` }, 502);
  }
  const sent = (await providerRes.json().catch(() => ({}))) as { id?: string };
  return c.json({ ok: true, provider_id: sent.id ?? null, to });
});

app.post("/api/prescriptions", async (c) => {
  const parsed = await parseJson(c, PrescriptionInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO prescriptions (patient_id, practitioner_id, issued_date, template, large_print, tooth, plan_item_id, diagnosis, advice, follow_up)
     VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.patient_id,
      d.practitioner_id ?? null,
      d.issued_date ?? null,
      d.template ?? "chamber",
      d.large_print ? 1 : 0,
      d.tooth ?? null,
      d.plan_item_id ?? null,
      d.diagnosis ?? null,
      d.advice ?? null,
      d.follow_up ?? null,
    ],
  );
  const rxId = Number(result.lastInsertRowid);
  for (const [i, item] of d.items.entries()) {
    await run(
      "INSERT INTO prescription_items (prescription_id, drug_name, dosage, frequency, duration, instructions, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [rxId, item.drug_name, item.dosage ?? null, item.frequency ?? null, item.duration ?? null, item.instructions ?? null, i],
    );
  }
  await attachPrescriptionImages(rxId, d.patient_id, d.image_ids);
  const rx = await loadPrescription(rxId);
  return c.json({ prescription: rx }, 201);
});

app.put("/api/prescriptions/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, PrescriptionUpdateInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const existing = await get<{ id: number; patient_id: number }>("SELECT id, patient_id FROM prescriptions WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of ["practitioner_id", "issued_date", "template", "large_print", "tooth", "plan_item_id", "diagnosis", "advice", "follow_up"] as const) {
    const v = d[key];
    if (v !== undefined) {
      sets.push(`${key} = ?`);
      params.push(key === "large_print" ? (v ? 1 : 0) : (v ?? null));
    }
  }
  if (sets.length) {
    params.push(id);
    await run(`UPDATE prescriptions SET ${sets.join(", ")} WHERE id = ?`, params);
  }
  if (d.items !== undefined) {
    await run("DELETE FROM prescription_items WHERE prescription_id = ?", [id]);
    for (const [i, item] of d.items.entries()) {
      await run(
        "INSERT INTO prescription_items (prescription_id, drug_name, dosage, frequency, duration, instructions, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, item.drug_name, item.dosage ?? null, item.frequency ?? null, item.duration ?? null, item.instructions ?? null, i],
      );
    }
  }
  if (d.image_ids !== undefined) {
    await attachPrescriptionImages(id, existing.patient_id, d.image_ids);
  }
  const rx = await loadPrescription(id);
  return c.json({ prescription: rx });
});

app.delete("/api/prescriptions/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM prescriptions WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Appointments ───────────────────────────────────────────────────

const AppointmentInput = z.object({
  patient_id: z.number().int().nullable().optional(),
  practitioner_id: z.number().int().nullable().optional(),
  operatory_id: z.number().int(),
  treatment_type_id: z.number().int().nullable().optional(),
  start_time: z.string(),
  end_time: z.string(),
  status: z.enum(["scheduled", "arrived", "in_chair", "completed", "no_show", "cancelled"]).optional(),
  kind: z.enum(["patient", "break", "lunch", "block"]).optional(),
  title: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const APPT_SELECT = `
  SELECT
    a.*,
    p.first_name as patient_first_name,
    p.last_name as patient_last_name,
    p.date_of_birth as patient_date_of_birth,
    pr.name as practitioner_name,
    pr.color as practitioner_color,
    o.name as operatory_name,
    tt.code as treatment_code,
    tt.name as treatment_name,
    tt.color as treatment_color
  FROM appointments a
  LEFT JOIN patients p ON p.id = a.patient_id
  LEFT JOIN practitioners pr ON pr.id = a.practitioner_id
  LEFT JOIN operatories o ON o.id = a.operatory_id
  LEFT JOIN treatment_types tt ON tt.id = a.treatment_type_id
`;

app.get("/api/appointments", async (c) => {
  // Day-view query: ?date=YYYY-MM-DD returns appointments overlapping that local day.
  const date = c.req.query("date");
  // Range query: ?from=YYYY-MM-DD&to=YYYY-MM-DD (inclusive) for dashboards/calendars.
  const from = c.req.query("from");
  const to = c.req.query("to");
  const patientId = intParam(c.req.query("patient_id"));
  if (patientId) {
    const rows = await query(`${APPT_SELECT} WHERE a.patient_id = ? ORDER BY a.start_time DESC LIMIT 200`, [patientId]);
    return c.json({ appointments: rows });
  }
  if (date) {
    const dayStart = `${date}T00:00:00`;
    const dayEnd = `${date}T23:59:59`;
    const rows = await query(
      `${APPT_SELECT} WHERE a.start_time < ? AND a.end_time > ? ORDER BY a.start_time`,
      [dayEnd, dayStart],
    );
    return c.json({ appointments: rows });
  }
  if (from && to) {
    const rows = await query(
      `${APPT_SELECT} WHERE substr(a.start_time, 1, 10) >= ? AND substr(a.start_time, 1, 10) <= ? ORDER BY a.start_time`,
      [from, to],
    );
    return c.json({ appointments: rows });
  }
  const rows = await query(`${APPT_SELECT} ORDER BY a.start_time DESC LIMIT 200`);
  return c.json({ appointments: rows });
});

app.post("/api/appointments", async (c) => {
  const parsed = await parseJson(c, AppointmentInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO appointments
       (patient_id, practitioner_id, operatory_id, treatment_type_id, start_time, end_time, status, kind, title, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.patient_id ?? null,
      d.practitioner_id ?? null,
      d.operatory_id,
      d.treatment_type_id ?? null,
      d.start_time,
      d.end_time,
      d.status ?? "scheduled",
      d.kind ?? "patient",
      d.title ?? null,
      d.notes ?? null,
    ],
  );
  const row = await get(`${APPT_SELECT} WHERE a.id = ?`, [result.lastInsertRowid]);
  return c.json({ appointment: row }, 201);
});

app.put("/api/appointments/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, AppointmentInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE appointments SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${APPT_SELECT} WHERE a.id = ?`, [id]);
  return c.json({ appointment: row });
});

app.delete("/api/appointments/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM appointments WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Treatment plan items ───────────────────────────────────────────

const TreatmentPlanItemInput = z.object({
  patient_id: z.number().int(),
  treatment_type_id: z.number().int().nullable().optional(),
  tooth: z.string().optional().nullable(),
  surface: z.string().optional().nullable(),
  fee: z.number().min(0).optional(),
  status: z.enum(["planned", "accepted", "completed", "declined"]).optional(),
  notes: z.string().optional().nullable(),
  sort_order: z.number().int().optional(),
});

app.get("/api/patients/:id/treatment-plan", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rows = await query(
    `SELECT tpi.*, tt.code as treatment_code, tt.name as treatment_name, tt.color as treatment_color
     FROM treatment_plan_items tpi
     LEFT JOIN treatment_types tt ON tt.id = tpi.treatment_type_id
     WHERE tpi.patient_id = ?
     ORDER BY tpi.sort_order, tpi.id`,
    [id],
  );
  return c.json({ items: rows });
});

app.post("/api/treatment-plan-items", async (c) => {
  const parsed = await parseJson(c, TreatmentPlanItemInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO treatment_plan_items (patient_id, treatment_type_id, tooth, surface, fee, status, notes, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM treatment_plan_items WHERE patient_id = ?)))`,
    [d.patient_id, d.treatment_type_id ?? null, d.tooth ?? null, d.surface ?? null, d.fee ?? 0, d.status ?? "planned", d.notes ?? null, d.sort_order ?? null, d.patient_id],
  );
  const row = await get(
    `SELECT tpi.*, tt.code as treatment_code, tt.name as treatment_name, tt.color as treatment_color
     FROM treatment_plan_items tpi LEFT JOIN treatment_types tt ON tt.id = tpi.treatment_type_id
     WHERE tpi.id = ?`,
    [result.lastInsertRowid],
  );
  return c.json({ item: row }, 201);
});

app.put("/api/treatment-plan-items/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, TreatmentPlanItemInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE treatment_plan_items SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(
    `SELECT tpi.*, tt.code as treatment_code, tt.name as treatment_name, tt.color as treatment_color
     FROM treatment_plan_items tpi LEFT JOIN treatment_types tt ON tt.id = tpi.treatment_type_id
     WHERE tpi.id = ?`,
    [id],
  );
  return c.json({ item: row });
});

app.delete("/api/treatment-plan-items/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM treatment_plan_items WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Clinical notes ─────────────────────────────────────────────────

const ClinicalNoteInput = z.object({
  patient_id: z.number().int(),
  practitioner_id: z.number().int().nullable().optional(),
  note_date: z.string().optional(),
  body: z.string().min(1),
});

app.get("/api/patients/:id/notes", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rows = await query(
    `SELECT cn.*, pr.name as practitioner_name
     FROM clinical_notes cn LEFT JOIN practitioners pr ON pr.id = cn.practitioner_id
     WHERE cn.patient_id = ? ORDER BY cn.note_date DESC`,
    [id],
  );
  return c.json({ notes: rows });
});

app.post("/api/clinical-notes", async (c) => {
  const parsed = await parseJson(c, ClinicalNoteInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    "INSERT INTO clinical_notes (patient_id, practitioner_id, note_date, body) VALUES (?, ?, COALESCE(?, datetime('now')), ?)",
    [d.patient_id, d.practitioner_id ?? null, d.note_date ?? null, d.body],
  );
  const row = await get(
    `SELECT cn.*, pr.name as practitioner_name FROM clinical_notes cn LEFT JOIN practitioners pr ON pr.id = cn.practitioner_id WHERE cn.id = ?`,
    [result.lastInsertRowid],
  );
  return c.json({ note: row }, 201);
});

app.delete("/api/clinical-notes/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM clinical_notes WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Tooth chart conditions ─────────────────────────────────────────

const ToothConditionInput = z.object({
  patient_id: z.number().int(),
  tooth: z.string().min(1),
  surface: z.string().optional().nullable(),
  condition: z.enum(["caries", "restoration", "crown", "missing", "implant", "endo"]),
});

app.get("/api/patients/:id/tooth-chart", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rows = await query(
    "SELECT * FROM tooth_conditions WHERE patient_id = ? ORDER BY tooth, surface",
    [id],
  );
  return c.json({ conditions: rows });
});

app.post("/api/tooth-conditions", async (c) => {
  const parsed = await parseJson(c, ToothConditionInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    "INSERT INTO tooth_conditions (patient_id, tooth, surface, condition) VALUES (?, ?, ?, ?)",
    [d.patient_id, d.tooth, d.surface ?? null, d.condition],
  );
  const row = await get("SELECT * FROM tooth_conditions WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ condition: row }, 201);
});

app.delete("/api/tooth-conditions/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM tooth_conditions WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Invoices ───────────────────────────────────────────────────────

const InvoiceInput = z.object({
  patient_id: z.number().int(),
  appointment_id: z.number().int().nullable().optional(),
  status: z.enum(["open", "paid", "void"]).optional(),
  total: z.number().min(0).optional(),
  amount_paid: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
});

app.get("/api/patients/:id/invoices", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const invoices = await query(
    "SELECT *, total - amount_paid AS balance FROM invoices WHERE patient_id = ? ORDER BY issued_at DESC",
    [id],
  );
  return c.json({ invoices });
});

// Full invoice detail: header + line items + payment history.
app.get("/api/invoices/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const invoice = await get(
    `SELECT i.*, i.total - i.amount_paid AS balance,
            p.first_name as patient_first_name, p.last_name as patient_last_name,
            p.date_of_birth as patient_date_of_birth
     FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id WHERE i.id = ?`,
    [id],
  );
  if (!invoice) return c.json({ error: "Not found" }, 404);
  const items = await query(
    "SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order, id",
    [id],
  );
  const payments = await query(
    "SELECT id, amount, method, paid_at, note FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC",
    [id],
  );
  return c.json({ invoice, items, payments });
});

// Replace the line items of an invoice and recompute its total.
app.put("/api/invoices/:id/items", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(
    c,
    z.object({
      items: z
        .array(
          z.object({
            description: z.string().min(1),
            quantity: z.number().min(1).optional(),
            unit_price: z.number().min(0),
            treatment_type_id: z.number().int().nullable().optional(),
          }),
        )
        .max(100),
    }),
  );
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const existing = await get("SELECT id FROM invoices WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  await run("DELETE FROM invoice_items WHERE invoice_id = ?", [id]);
  let total = 0;
  for (const [i, item] of parsed.data.items.entries()) {
    const qty = item.quantity ?? 1;
    total += qty * item.unit_price;
    await run(
      "INSERT INTO invoice_items (invoice_id, treatment_type_id, description, quantity, unit_price, sort_order) VALUES (?, ?, ?, ?, ?, ?)",
      [id, item.treatment_type_id ?? null, item.description, qty, item.unit_price, i],
    );
  }
  await run("UPDATE invoices SET total = ? WHERE id = ?", [Math.round(total * 100) / 100, id]);
  const row = await get("SELECT *, total - amount_paid AS balance FROM invoices WHERE id = ?", [id]);
  return c.json({ invoice: row });
});

// Record a payment; keeps invoices.amount_paid (and thus balance) in sync.
app.post("/api/invoices/:id/payments", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(
    c,
    z.object({
      amount: z.number().positive(),
      method: z.enum(["cash", "card", "transfer", "insurance", "other"]).optional(),
      note: z.string().optional().nullable(),
    }),
  );
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const invoice = await get("SELECT id, total, amount_paid FROM invoices WHERE id = ?", [id]);
  if (!invoice) return c.json({ error: "Not found" }, 404);
  const newPaid = Math.round(((invoice.amount_paid as number) + parsed.data.amount) * 100) / 100;
  if (newPaid > (invoice.total as number) + 0.001) {
    return c.json({ error: "Payment exceeds the outstanding balance" }, 400);
  }
  await run(
    "INSERT INTO invoice_payments (invoice_id, amount, method, note) VALUES (?, ?, ?, ?)",
    [id, parsed.data.amount, parsed.data.method ?? "cash", parsed.data.note ?? null],
  );
  await run(
    "UPDATE invoices SET amount_paid = ?, status = CASE WHEN ? >= total THEN 'paid' ELSE status END WHERE id = ?",
    [newPaid, newPaid, id],
  );
  const row = await get("SELECT *, total - amount_paid AS balance FROM invoices WHERE id = ?", [id]);
  return c.json({ invoice: row }, 201);
});

// Remove a payment (mis-entry correction); recompute from the ledger, not a delta.
app.delete("/api/invoices/:id/payments/:paymentId", async (c) => {
  const id = intParam(c.req.param("id"));
  const paymentId = intParam(c.req.param("paymentId"));
  if (!id || !paymentId) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM invoice_payments WHERE id = ? AND invoice_id = ?", [paymentId, id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const sumRow = await get("SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments WHERE invoice_id = ?", [id]);
  const paid = Math.round((sumRow?.s as number) * 100) / 100;
  await run(
    "UPDATE invoices SET amount_paid = ?, status = CASE WHEN amount_paid > 0 AND amount_paid < total THEN 'open' WHEN amount_paid >= total THEN 'paid' ELSE status END WHERE id = ?",
    [paid, id],
  );
  const row = await get("SELECT *, total - amount_paid AS balance FROM invoices WHERE id = ?", [id]);
  return c.json({ invoice: row });
});// ── CSV export (accounting-friendly) ─────────────────────────

// Outstanding balance per patient (open invoices only) — powers the list badge.
app.get("/api/reports/balances", async (c) => {
  const rows = await query<{ patient_id: number; due: number }>(
    "SELECT patient_id, SUM(total - amount_paid) AS due FROM invoices WHERE status = 'open' AND total > amount_paid GROUP BY patient_id",
  ).catch(() => [] as { patient_id: number; due: number }[]);
  const balances: Record<string, number> = {};
  for (const r of rows) balances[String(r.patient_id)] = Math.round(r.due * 100) / 100;
  return c.json({ balances });
});

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvResponse(filename: string, rows: unknown[][]): Response {
  const body = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

app.get("/api/export/patients.csv", async (c) => {
  const rows = await query<Record<string, unknown>>(
    "SELECT id, first_name, last_name, date_of_birth, email, phone, address, medical_alerts, referral_source, created_at FROM patients ORDER BY id",
  );
  return csvResponse("patients.csv", [
    ["id", "first_name", "last_name", "date_of_birth", "email", "phone", "address", "medical_alerts", "referral_source", "created_at"],
    ...rows.map((r) => [r.id, r.first_name, r.last_name, r.date_of_birth, r.email, r.phone, r.address, r.medical_alerts, r.referral_source, r.created_at]),
  ]);
});

app.get("/api/export/invoices.csv", async (c) => {
  const rows = await query<Record<string, unknown>>(
    `SELECT i.id, i.issued_at, i.status, i.total, i.amount_paid, i.total - i.amount_paid AS balance,
            p.first_name, p.last_name
     FROM invoices i LEFT JOIN patients p ON p.id = i.patient_id ORDER BY i.id`,
  );
  return csvResponse("invoices.csv", [
    ["id", "issued_at", "status", "total", "amount_paid", "balance", "patient"],
    ...rows.map((r) => [r.id, r.issued_at, r.status, r.total, r.amount_paid, r.balance, `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim()]),
  ]);
});

app.post("/api/invoices", async (c) => {
  const parsed = await parseJson(c, InvoiceInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    "INSERT INTO invoices (patient_id, appointment_id, status, total, amount_paid, notes) VALUES (?, ?, ?, ?, ?, ?)",
    [d.patient_id, d.appointment_id ?? null, d.status ?? "open", d.total ?? 0, d.amount_paid ?? 0, d.notes ?? null],
  );
  const row = await get("SELECT * FROM invoices WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ invoice: row }, 201);
});

app.put("/api/invoices/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, InvoiceInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE invoices SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM invoices WHERE id = ?", [id]);
  return c.json({ invoice: row });
});

app.delete("/api/invoices/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM invoices WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Waiting list ───────────────────────────────────────────────────

const WaitingListInput = z.object({
  patient_id: z.number().int(),
  treatment_type_id: z.number().int().nullable().optional(),
  preferred_practitioner_id: z.number().int().nullable().optional(),
  duration_minutes: z.number().int().min(5).optional(),
  notes: z.string().optional().nullable(),
});

const WAITING_SELECT = `
  SELECT w.*, p.first_name, p.last_name, p.date_of_birth,
    tt.name as treatment_name, tt.color as treatment_color,
    pr.name as practitioner_name
  FROM waiting_list w
  LEFT JOIN patients p ON p.id = w.patient_id
  LEFT JOIN treatment_types tt ON tt.id = w.treatment_type_id
  LEFT JOIN practitioners pr ON pr.id = w.preferred_practitioner_id
`;

app.get("/api/waiting-list", async (c) => {
  const rows = await query(`${WAITING_SELECT} ORDER BY w.created_at DESC`);
  return c.json({ waiting: rows });
});

app.post("/api/waiting-list", async (c) => {
  const parsed = await parseJson(c, WaitingListInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    "INSERT INTO waiting_list (patient_id, treatment_type_id, preferred_practitioner_id, duration_minutes, notes) VALUES (?, ?, ?, ?, ?)",
    [d.patient_id, d.treatment_type_id ?? null, d.preferred_practitioner_id ?? null, d.duration_minutes ?? 30, d.notes ?? null],
  );
  const row = await get(`${WAITING_SELECT} WHERE w.id = ?`, [result.lastInsertRowid]);
  return c.json({ entry: row }, 201);
});

app.delete("/api/waiting-list/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM waiting_list WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Appointments to make ───────────────────────────────────────────

const ToMakeInput = z.object({
  patient_id: z.number().int(),
  treatment_type_id: z.number().int().nullable().optional(),
  due_after: z.string().optional().nullable(),
  source: z.enum(["reception", "patient", "system"]).optional(),
  notes: z.string().optional().nullable(),
  status: z.enum(["open", "scheduled", "cancelled"]).optional(),
});

const TO_MAKE_SELECT = `
  SELECT atm.*, p.first_name, p.last_name, p.date_of_birth,
    tt.name as treatment_name, tt.color as treatment_color
  FROM appointments_to_make atm
  LEFT JOIN patients p ON p.id = atm.patient_id
  LEFT JOIN treatment_types tt ON tt.id = atm.treatment_type_id
`;

app.get("/api/appointments-to-make", async (c) => {
  const source = c.req.query("source");
  const where = source ? " WHERE atm.source = ? AND atm.status = 'open'" : " WHERE atm.status = 'open'";
  const params = source ? [source] : [];
  const rows = await query(`${TO_MAKE_SELECT}${where} ORDER BY atm.created_at DESC`, params);
  return c.json({ to_make: rows });
});

app.post("/api/appointments-to-make", async (c) => {
  const parsed = await parseJson(c, ToMakeInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    "INSERT INTO appointments_to_make (patient_id, treatment_type_id, due_after, source, notes, status) VALUES (?, ?, ?, ?, ?, ?)",
    [d.patient_id, d.treatment_type_id ?? null, d.due_after ?? null, d.source ?? "reception", d.notes ?? null, d.status ?? "open"],
  );
  const row = await get(`${TO_MAKE_SELECT} WHERE atm.id = ?`, [result.lastInsertRowid]);
  return c.json({ entry: row }, 201);
});

app.put("/api/appointments-to-make/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, ToMakeInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE appointments_to_make SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${TO_MAKE_SELECT} WHERE atm.id = ?`, [id]);
  return c.json({ entry: row });
});

app.delete("/api/appointments-to-make/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM appointments_to_make WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Insurance plans ────────────────────────────────────────────────

const InsurancePlanInput = z.object({
  patient_id: z.number().int(),
  rank: z.enum(["primary", "secondary", "tertiary"]).optional(),
  carrier: z.string().min(1),
  member_id: z.string().optional().nullable(),
  group_id: z.string().optional().nullable(),
  subscriber_name: z.string().optional().nullable(),
  subscriber_dob: z.string().optional().nullable(),
  effective_date: z.string().optional().nullable(),
  term_date: z.string().optional().nullable(),
  copay: z.number().min(0).optional(),
  deductible_total: z.number().min(0).optional(),
  deductible_used: z.number().min(0).optional(),
  max_annual: z.number().min(0).optional(),
  max_used: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
});

app.get("/api/patients/:id/insurance", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  // Fall back to [] if the table doesn't exist yet (pre-migration dev DB).
  const rows = await query(
    "SELECT * FROM insurance_plans WHERE patient_id = ? ORDER BY CASE rank WHEN 'primary' THEN 0 WHEN 'secondary' THEN 1 ELSE 2 END",
    [id],
  ).catch(() => []);
  return c.json({ plans: rows });
});

app.post("/api/insurance-plans", async (c) => {
  const parsed = await parseJson(c, InsurancePlanInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO insurance_plans
       (patient_id, rank, carrier, member_id, group_id, subscriber_name, subscriber_dob,
        effective_date, term_date, copay, deductible_total, deductible_used, max_annual, max_used, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.patient_id, d.rank ?? "primary", d.carrier,
      d.member_id ?? null, d.group_id ?? null, d.subscriber_name ?? null, d.subscriber_dob ?? null,
      d.effective_date ?? null, d.term_date ?? null,
      d.copay ?? 0, d.deductible_total ?? 0, d.deductible_used ?? 0, d.max_annual ?? 0, d.max_used ?? 0,
      d.notes ?? null,
    ],
  );
  const row = await get("SELECT * FROM insurance_plans WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ plan: row }, 201);
});

app.put("/api/insurance-plans/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, InsurancePlanInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE insurance_plans SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM insurance_plans WHERE id = ?", [id]);
  return c.json({ plan: row });
});

app.delete("/api/insurance-plans/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM insurance_plans WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Lab cases ─────────────────────────────────────────────────────

const LabCaseInput = z.object({
  patient_id: z.number().int(),
  practitioner_id: z.number().int().nullable().optional(),
  treatment_type_id: z.number().int().nullable().optional(),
  lab_name: z.string().min(1),
  case_type: z.string().min(1),
  tooth: z.string().optional().nullable(),
  shade: z.string().optional().nullable(),
  fee: z.number().min(0).optional(),
  sent_at: z.string().optional().nullable(),
  due_at: z.string().optional().nullable(),
  received_at: z.string().optional().nullable(),
  seated_at: z.string().optional().nullable(),
  status: z.enum(["sent", "in_lab", "received", "seated", "cancelled"]).optional(),
  notes: z.string().optional().nullable(),
});

const LAB_SELECT = `
  SELECT lc.*,
    p.first_name, p.last_name,
    pr.name as practitioner_name,
    tt.code as treatment_code, tt.name as treatment_name
  FROM lab_cases lc
  LEFT JOIN patients p ON p.id = lc.patient_id
  LEFT JOIN practitioners pr ON pr.id = lc.practitioner_id
  LEFT JOIN treatment_types tt ON tt.id = lc.treatment_type_id
`;

app.get("/api/lab-cases", async (c) => {
  const status = c.req.query("status");
  const where = status ? "WHERE lc.status = ?" : "";
  const params = status ? [status] : [];
  // Fall back to [] if the table doesn't exist yet (pre-migration dev DB).
  const rows = await query(`${LAB_SELECT} ${where} ORDER BY lc.due_at ASC, lc.id DESC`, params)
    .catch(() => []);
  return c.json({ cases: rows });
});

app.post("/api/lab-cases", async (c) => {
  const parsed = await parseJson(c, LabCaseInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO lab_cases
       (patient_id, practitioner_id, treatment_type_id, lab_name, case_type, tooth, shade, fee,
        sent_at, due_at, received_at, seated_at, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.patient_id, d.practitioner_id ?? null, d.treatment_type_id ?? null,
      d.lab_name, d.case_type, d.tooth ?? null, d.shade ?? null, d.fee ?? 0,
      d.sent_at ?? null, d.due_at ?? null, d.received_at ?? null, d.seated_at ?? null,
      d.status ?? "sent", d.notes ?? null,
    ],
  );
  const row = await get(`${LAB_SELECT} WHERE lc.id = ?`, [result.lastInsertRowid]);
  return c.json({ case: row }, 201);
});

app.put("/api/lab-cases/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, LabCaseInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE lab_cases SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${LAB_SELECT} WHERE lc.id = ?`, [id]);
  return c.json({ case: row });
});

app.delete("/api/lab-cases/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM lab_cases WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Reports ───────────────────────────────────────────────────────

app.get("/api/reports/summary", async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = `${today.slice(0, 8)}01`;
  const startOfWeek = (() => {
    const d = new Date(`${today}T00:00:00`);
    const dow = d.getDay();
    const diff = (dow + 6) % 7; // make Monday the start
    d.setDate(d.getDate() - diff);
    return d.toISOString().slice(0, 10);
  })();

  // Per-query .catch so a missing table/column on a partially-migrated dev DB
  // doesn't take down the whole report.
  const safeGet = <T,>(sql: string, params: unknown[] = [], fallback: T) =>
    get<T>(sql, params).catch(() => fallback as T | undefined).then((v) => v ?? fallback);
  const safeQuery = <T,>(sql: string, params: unknown[] = []): Promise<T[]> =>
    query<T>(sql, params).catch(() => [] as T[]);

  const [
    todayAppts,
    weekAppts,
    monthAppts,
    monthCompleted,
    monthNoShows,
    monthCancelled,
    byTreatmentRows,
    bySourceRows,
    productionRow,
    paidRow,
    aged0_30,
    aged31_60,
    aged61_90,
    aged90,
    overdueLabs,
    waitingCount,
  ] = await Promise.all([
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM appointments WHERE substr(start_time, 1, 10) = ? AND kind = 'patient'", [today], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM appointments WHERE substr(start_time, 1, 10) >= ? AND kind = 'patient'", [startOfWeek], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM appointments WHERE substr(start_time, 1, 10) >= ? AND kind = 'patient'", [startOfMonth], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM appointments WHERE substr(start_time, 1, 10) >= ? AND status = 'completed'", [startOfMonth], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM appointments WHERE substr(start_time, 1, 10) >= ? AND status = 'no_show'", [startOfMonth], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM appointments WHERE substr(start_time, 1, 10) >= ? AND status = 'cancelled'", [startOfMonth], { n: 0 }),
    safeQuery<{ name: string; n: number; total: number }>(
      `SELECT COALESCE(tt.name, 'Unspecified') as name, COUNT(*) as n, COALESCE(SUM(tt.default_fee), 0) as total
       FROM appointments a LEFT JOIN treatment_types tt ON tt.id = a.treatment_type_id
       WHERE substr(a.start_time, 1, 10) >= ? AND a.kind = 'patient'
       GROUP BY tt.id ORDER BY n DESC`,
      [startOfMonth],
    ),
    safeQuery<{ source: string; n: number }>(
      `SELECT COALESCE(NULLIF(referral_source, ''), 'Unknown') as source, COUNT(*) as n
       FROM patients GROUP BY source ORDER BY n DESC`,
    ),
    safeGet<{ total: number }>(
      "SELECT COALESCE(SUM(total), 0) as total FROM invoices WHERE substr(issued_at, 1, 10) >= ? AND status != 'void'",
      [startOfMonth], { total: 0 },
    ),
    safeGet<{ total: number }>(
      "SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices WHERE substr(issued_at, 1, 10) >= ? AND status != 'void'",
      [startOfMonth], { total: 0 },
    ),
    safeGet<{ total: number }>(
      `SELECT COALESCE(SUM(total - amount_paid), 0) as total FROM invoices
       WHERE status = 'open' AND julianday('now') - julianday(issued_at) <= 30`, [], { total: 0 },
    ),
    safeGet<{ total: number }>(
      `SELECT COALESCE(SUM(total - amount_paid), 0) as total FROM invoices
       WHERE status = 'open' AND julianday('now') - julianday(issued_at) > 30 AND julianday('now') - julianday(issued_at) <= 60`, [], { total: 0 },
    ),
    safeGet<{ total: number }>(
      `SELECT COALESCE(SUM(total - amount_paid), 0) as total FROM invoices
       WHERE status = 'open' AND julianday('now') - julianday(issued_at) > 60 AND julianday('now') - julianday(issued_at) <= 90`, [], { total: 0 },
    ),
    safeGet<{ total: number }>(
      `SELECT COALESCE(SUM(total - amount_paid), 0) as total FROM invoices
       WHERE status = 'open' AND julianday('now') - julianday(issued_at) > 90`, [], { total: 0 },
    ),
    safeGet<{ n: number }>(
      `SELECT COUNT(*) as n FROM lab_cases WHERE due_at < datetime('now') AND received_at IS NULL AND status NOT IN ('cancelled', 'received', 'seated')`,
      [], { n: 0 },
    ),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM waiting_list", [], { n: 0 }),
  ]);

  return c.json({
    today_appointments: todayAppts.n ?? 0,
    week_appointments: weekAppts.n ?? 0,
    month_appointments: monthAppts.n ?? 0,
    month_completed: monthCompleted.n ?? 0,
    month_no_shows: monthNoShows.n ?? 0,
    month_cancelled: monthCancelled.n ?? 0,
    month_production: productionRow.total ?? 0,
    month_collections: paidRow.total ?? 0,
    by_treatment: byTreatmentRows,
    by_source: bySourceRows,
    aged_receivables: {
      "0-30": aged0_30.total ?? 0,
      "31-60": aged31_60.total ?? 0,
      "61-90": aged61_90.total ?? 0,
      "90+": aged90.total ?? 0,
    },
    overdue_lab_cases: overdueLabs.n ?? 0,
    waiting_list_count: waitingCount.n ?? 0,
  });
});

// ── Backups: export / import / snapshots / auto-backup schedule ───

const BackupSettingsInput = z.object({
  auto_backup_interval_minutes: z.number().int().min(0).max(10080).optional(), // 0 = off, max 1 week
  auto_backup_keep: z.number().int().min(1).max(100).optional(),
});

async function getSettingsForBackup() {
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key IN ('auto_backup_interval_minutes', 'auto_backup_keep')",
  ).catch(() => []);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const interval = parseInt(map.auto_backup_interval_minutes ?? "0", 10);
  const keep = parseInt(map.auto_backup_keep ?? "10", 10);
  return {
    auto_backup_interval_minutes: Number.isFinite(interval) && interval >= 0 ? interval : 0,
    auto_backup_keep: Number.isFinite(keep) && keep >= 1 ? Math.min(keep, 100) : 10,
  };
}

// Read the auto-backup schedule (merged with defaults).
app.get("/api/backup/settings", async (c) => {
  const settings = await getSettingsForBackup();
  return c.json({ settings });
});

// Update the auto-backup schedule. Values are validated; 0 disables auto-backup.
app.put("/api/backup/settings", async (c) => {
  const parsed = await parseJson(c, BackupSettingsInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  if (d.auto_backup_interval_minutes === undefined && d.auto_backup_keep === undefined) {
    return c.json({ error: "No fields" }, 400);
  }
  const updates: [string, string][] = [];
  if (d.auto_backup_interval_minutes !== undefined) {
    updates.push(["auto_backup_interval_minutes", String(d.auto_backup_interval_minutes)]);
  }
  if (d.auto_backup_keep !== undefined) {
    updates.push(["auto_backup_keep", String(d.auto_backup_keep)]);
  }
  for (const [key, value] of updates) {
    await run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }
  const settings = await getSettingsForBackup();
  return c.json({ settings });
});

// Downloadable portable export of EVERY data table.
app.get("/api/backup/export", async (c) => {
  const payload = await dumpAllData();
  const json = JSON.stringify(payload, null, 2);
  const stamp = payload.created_at.slice(0, 10);
  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dental-canvas-backup-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
});

// Snapshot list + stats (payloads excluded — they can be megabytes).
app.get("/api/backup/snapshots", async (c) => {
  const [snapshots, stats] = await Promise.all([listSnapshots(50), snapshotsStats()]);
  return c.json({ snapshots, stats });
});

// Create a snapshot now (manual).
app.post("/api/backup/snapshots", async (c) => {
  const backupSettings = await getSettingsForBackup();
  const { snapshot } = await createSnapshot("manual", "user", backupSettings.auto_backup_keep);
  return c.json({ snapshot }, 201);
});

app.get("/api/backup/snapshots/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const payload = await getSnapshotPayload(id);
  if (!payload) return c.json({ error: "Not found" }, 404);
  const json = JSON.stringify(payload, null, 2);
  return new Response(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dental-canvas-backup-${payload.created_at.slice(0, 10)}-id${id}.json"`,
      "Cache-Control": "no-store",
    },
  });
});

app.delete("/api/backup/snapshots/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const ok = await deleteSnapshot(id);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// Timer-driven auto backup — called by the client when its countdown fires.
app.post("/api/backup/auto", async (c) => {
  const backupSettings = await getSettingsForBackup();
  if (backupSettings.auto_backup_interval_minutes === 0) {
    return c.json({ skipped: true, reason: "auto-backup disabled" }, 200);
  }
  const { snapshot } = await createSnapshot("auto", "timer", backupSettings.auto_backup_keep);
  return c.json({ snapshot }, 201);
});

// Import: accept a portable backup JSON, safety-snapshot first, then replace.
app.post("/api/backup/import", async (c) => {
  let bodyText: string;
  try {
    bodyText = await c.req.text();
  } catch {
    return c.json({ error: "Could not read request body" }, 400);
  }
  if (isPayloadTooLarge(bodyText)) {
    return c.json({ error: "Backup file too large (limit 64 MB)" }, 413);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    return c.json({ error: "Invalid JSON — is this a Dental Canvas backup file?" }, 400);
  }
  const validated = validateBackupPayload(raw);
  if (!validated.ok) return c.json({ error: validated.error }, 400);

  const keep = (await getSettingsForBackup()).auto_backup_keep;

  // Safety net: snapshot current state BEFORE destructive import so a bad
  // import can be undone.
  await createSnapshot("manual", "pre-import", keep);

  const payload = validated.data as BackupPayload;
  const counts = await restoreFromBackup(payload);

  return c.json({
    ok: true,
    restored: counts,
    imported_rows: Object.values(counts).reduce((a, b) => a + (b ?? 0), 0),
  });
});

// Restore from a stored snapshot by id.
app.post("/api/backup/snapshots/:id/restore", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const payload = await getSnapshotPayload(id);
  if (!payload) return c.json({ error: "Not found" }, 404);

  const keep = (await getSettingsForBackup()).auto_backup_keep;
  // Safety net before rolling back to the snapshot.
  await createSnapshot("manual", "pre-restore", keep);

  const counts = await restoreFromBackup(payload);
  return c.json({ ok: true, restored: counts });
});

// Dry-run inspection of an uploaded backup without importing anything.
app.post("/api/backup/inspect", async (c) => {
  let bodyText: string;
  try {
    bodyText = await c.req.text();
  } catch {
    return c.json({ error: "Could not read request body" }, 400);
  }
  if (isPayloadTooLarge(bodyText)) return c.json({ error: "Backup file too large (limit 64 MB)" }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    return c.json({ error: "Invalid JSON — is this a Dental Canvas backup file?" }, 400);
  }
  const validated = validateBackupPayload(raw);
  if (!validated.ok) return c.json({ error: validated.error }, 400);
  return c.json({
    ok: true,
    version: validated.data.version,
    created_at: validated.data.created_at,
    clinic_name: validated.data.clinic_name ?? null,
    counts: countRows(validated.data),
  });
});

// ── Dashboard ─────────────────────────────────────────────────────

app.get("/api/dashboard/summary", async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const startOfMonth = `${today.slice(0, 8)}01`;
  const prevMonthStart = (() => {
    const d = new Date(`${startOfMonth}T00:00:00`);
    d.setMonth(d.getMonth() - 1);
    return `${d.toISOString().slice(0, 8)}01`;
  })();

  const safeGet = <T,>(sql: string, params: unknown[] = [], fallback: T) =>
    get<T>(sql, params).catch(() => fallback as T | undefined).then((v) => v ?? fallback);

  const [
    totalToday,
    totalLastMonthSameDay,
    newPatients,
    newPatientsLastMonth,
    returningPatients,
    returningPatientsLastMonth,
    upcoming,
  ] = await Promise.all([
    // All patient visits today (the dashboard's headline number). Cancelled
    // visits and no-shows never made it to the chair, so they don't count.
    safeGet<{ n: number }>(
      "SELECT COUNT(*) as n FROM appointments WHERE substr(start_time, 1, 10) = ? AND kind = 'patient' AND status NOT IN ('cancelled', 'no_show')",
      [today], { n: 0 },
    ),
    // Same-period figure for last month's first day, used for the delta badge.
    safeGet<{ n: number }>(
      "SELECT COUNT(*) as n FROM appointments WHERE substr(start_time, 1, 10) = ? AND kind = 'patient' AND status NOT IN ('cancelled', 'no_show')",
      [prevMonthStart], { n: 0 },
    ),
    // "New" = no prior completed/visited appointment before this month.
    safeGet<{ n: number }>(
      `SELECT COUNT(*) as n FROM patients p
       WHERE NOT EXISTS (
         SELECT 1 FROM appointments a
         WHERE a.patient_id = p.id AND a.status = 'completed'
           AND substr(a.start_time, 1, 10) < ?
       )`,
      [startOfMonth], { n: 0 },
    ),
    safeGet<{ n: number }>(
      `SELECT COUNT(*) as n FROM patients p
       WHERE NOT EXISTS (
         SELECT 1 FROM appointments a
         WHERE a.patient_id = p.id AND a.status = 'completed'
           AND substr(a.start_time, 1, 10) < ?
       )`,
      [prevMonthStart], { n: 0 },
    ),
    // "Returning" = everyone with at least one completed visit before this month.
    safeGet<{ n: number }>(
      `SELECT COUNT(DISTINCT a.patient_id) as n FROM appointments a
       WHERE a.patient_id IS NOT NULL AND a.status = 'completed'
         AND substr(a.start_time, 1, 10) < ?`,
      [startOfMonth], { n: 0 },
    ),
    safeGet<{ n: number }>(
      `SELECT COUNT(DISTINCT a.patient_id) as n FROM appointments a
       WHERE a.patient_id IS NOT NULL AND a.status = 'completed'
         AND substr(a.start_time, 1, 10) < ?`,
      [prevMonthStart], { n: 0 },
    ),
    // Next 5 upcoming events: future patient appointments + open recalls.
    (async () => {
      const [futureAppts, recalls] = await Promise.all([
        query<{
          id: number; kind: string; title: string | null; patient_id: number | null;
          start_time: string; first_name: string | null; last_name: string | null;
          treatment_name: string | null; treatment_color: string | null; status: string;
        }>(
          `SELECT a.id, a.kind, a.title, a.patient_id, a.start_time, a.status,
                  p.first_name, p.last_name, tt.name as treatment_name, tt.color as treatment_color
           FROM appointments a
           LEFT JOIN patients p ON p.id = a.patient_id
           LEFT JOIN treatment_types tt ON tt.id = a.treatment_type_id
           WHERE a.start_time >= ? AND a.status NOT IN ('cancelled', 'no_show') AND a.kind = 'patient'
           ORDER BY a.start_time LIMIT 5`,
          [`${today}T00:00:00`],
        ).catch(() => []),
        query<{ id: number; kind: string; title: string | null; patient_id: number | null; start_time: string; first_name: string | null; last_name: string | null; treatment_name: string | null; treatment_color: string | null; status: string }>(
          `SELECT atm.id, 'recall' as kind, tt.name as title, atm.patient_id,
                  COALESCE(atm.due_after, '') as start_time, 'scheduled' as status,
                  p.first_name, p.last_name, tt.name as treatment_name, tt.color as treatment_color
           FROM appointments_to_make atm
           LEFT JOIN patients p ON p.id = atm.patient_id
           LEFT JOIN treatment_types tt ON tt.id = atm.treatment_type_id
           WHERE atm.status = 'open' AND (atm.due_after IS NULL OR atm.due_after >= ?)
           ORDER BY atm.due_after LIMIT 5`,
          [today],
        ).catch(() => []),
      ]);
      return [...futureAppts, ...recalls]
        .sort((x, y) => x.start_time.localeCompare(y.start_time))
        .slice(0, 5);
    })(),
  ]);

  const pct = (cur: number, prev: number): number | null =>
    prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

  return c.json({
    total_visits: totalToday.n ?? 0,
    visits_delta_pct: pct(totalToday.n ?? 0, totalLastMonthSameDay.n ?? 0),
    new_patients: newPatients.n ?? 0,
    new_patients_delta_pct: pct(newPatients.n ?? 0, newPatientsLastMonth.n ?? 0),
    returning_patients: returningPatients.n ?? 0,
    returning_patients_delta_pct: pct(returningPatients.n ?? 0, returningPatientsLastMonth.n ?? 0),
    upcoming,
  });
});

app.get("/api/dashboard/consultation", async (c) => {
  const id = intParam(c.req.query("patient_id"));
  if (!id) return c.json({ error: "patient_id is required" }, 400);

  const patient = await get<{
    id: number; first_name: string; last_name: string; date_of_birth: string | null;
    medical_alerts: string | null;
  }>("SELECT id, first_name, last_name, date_of_birth, medical_alerts FROM patients WHERE id = ?", [id]);
  if (!patient) return c.json({ error: "Patient not found" }, 404);

  const [lastAppt, conditions] = await Promise.all([
    get<{
      last_checked: string | null; observation: string | null;
      prescription: string | null;
      last_prescribed: string | null;
    }>(
      `SELECT
         (SELECT MAX(substr(start_time, 1, 10)) FROM appointments
          WHERE patient_id = ? AND status = 'completed') as last_checked,
         (SELECT body FROM clinical_notes WHERE patient_id = ? ORDER BY note_date DESC LIMIT 1) as observation,
         (SELECT GROUP_CONCAT(DISTINCT tc.condition) FROM tooth_conditions tc WHERE tc.patient_id = ?) as prescription,
         (SELECT MAX(issued_date) FROM prescriptions WHERE patient_id = ?) as last_prescribed`,
      [id, id, id, id],
    ),
    query<{ condition: string; n: number }>(
      "SELECT condition, COUNT(*) as n FROM tooth_conditions WHERE patient_id = ? GROUP BY condition",
      [id],
    ).catch(() => []),
  ]);

  return c.json({
    patient,
    last_checked: lastAppt?.last_checked ?? null,
    observation: lastAppt?.observation ?? null,
    prescription: lastAppt?.prescription ?? null,
    last_prescribed: lastAppt?.last_prescribed ?? null,
    conditions,
  });
});

// ── Dentist notes ──────────────────────────────────────────────────

const DentistNoteInput = z.object({
  body: z.string().min(1),
  pinned: z.boolean().optional(),
});

app.get("/api/dentist-notes", async (c) => {
  const rows = await query("SELECT * FROM dentist_notes ORDER BY pinned DESC, created_at DESC, id DESC")
    .catch(() => []);
  return c.json({ notes: rows });
});

app.post("/api/dentist-notes", async (c) => {
  const parsed = await parseJson(c, DentistNoteInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { body, pinned } = parsed.data;
  const result = await run(
    "INSERT INTO dentist_notes (body, pinned) VALUES (?, ?)",
    [body, pinned ? 1 : 0],
  );
  const row = await get("SELECT * FROM dentist_notes WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ note: row }, 201);
});

app.put("/api/dentist-notes/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, DentistNoteInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  if (parsed.data.body !== undefined) { sets.push("body = ?"); params.push(parsed.data.body); }
  if (parsed.data.pinned !== undefined) { sets.push("pinned = ?"); params.push(parsed.data.pinned ? 1 : 0); }
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE dentist_notes SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM dentist_notes WHERE id = ?", [id]);
  return c.json({ note: row });
});

app.delete("/api/dentist-notes/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM dentist_notes WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

/**
 * Settings whose raw values must never reach the browser. The server reads the
 * real values from the settings table directly; responses show a non-empty
 * placeholder so UI code can still tell "configured ✓" from "empty".
 */
const SECRET_SETTINGS = new Set(["storage_secret_access_key", "email_api_key"]);

function redactSettings(out: Record<string, string>): Record<string, string> {
  for (const key of SECRET_SETTINGS) {
    if (out[key]) out[key] = "••••••••";
  }
  return out;
}

app.get("/api/settings", async (c) => {
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM settings",
  ).catch(() => []);
  const out: Record<string, string> = { ...DEFAULT_SETTINGS, ...DEFAULT_PROFILE_SETTINGS, ...DEFAULT_BACKUP_SETTINGS, ...DEFAULT_INVENTORY_SETTINGS, ...DEFAULT_STORAGE_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return c.json({ settings: redactSettings(out) });
});

app.put("/api/settings", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "Body must be an object" }, 400);
  const entries = Object.entries(body as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null);
  for (const [key, value] of entries) {
    // The logo is the one setting that could smuggle markup into printed
    // documents — enforce the data-URL shape (empty string clears it).
    if (key === "clinic_logo" && value !== "" && !isSafeLogoDataUrl(value)) {
      return c.json({ error: "Logo must be an image data URL under 400 KB" }, 400);
    }
    await run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, String(value)],
    );
  }
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: Record<string, string> = { ...DEFAULT_SETTINGS, ...DEFAULT_PROFILE_SETTINGS, ...DEFAULT_BACKUP_SETTINGS, ...DEFAULT_INVENTORY_SETTINGS, ...DEFAULT_STORAGE_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return c.json({ settings: redactSettings(out) });
});

// ── Images & object storage (S3/R2, presigned URLs) ──────────────

/** Parse the JSON image-id list stored on a prescription defensively. */
function parseImageIds(raw: unknown): number[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)).map(Number) : [];
  } catch {
    return [];
  }
}

/** Resolve image rows (with display URLs) from ids, newest first, ignoring deleted. */
async function resolveImageRows(ids: number[]): Promise<Array<Record<string, unknown>>> {
  if (!ids.length) return [];
  const rows = await query(
    `SELECT id, patient_id, appointment_id, file_key, file_name, mime_type, size_bytes,
            kind, label, compare_group, uploaded_at
     FROM patient_images
     WHERE id IN (${ids.map(() => "?").join(",")}) AND deleted = 0
     ORDER BY uploaded_at DESC, id DESC`,
    ids,
  ).catch(() => [] as Array<Record<string, unknown>>);
  const byId = new Map(rows.map((r) => [Number(r.id), r]));
  const attachedIds = ids.filter((id) => byId.has(id));
  // Keep the order the doctor chose.
  const out: Array<Record<string, unknown>> = [];
  for (const id of attachedIds) {
    const r = byId.get(id)!;
    out.push({ ...r, url: await storageUrlForFile(String(r.file_key)) });
  }
  return out;
}

/** Store (or clear) the images attached to a prescription. Only images that
 *  belong to the same patient are accepted — never attach another patient's
 *  PHI to a sheet. */
async function attachPrescriptionImages(rxId: number, patientId: number, imageIds: number[] | undefined): Promise<void> {
  if (imageIds === undefined) return;
  let ids: number[] = [...new Set(imageIds)];
  if (ids.length) {
    const rows = await query<{ id: number }>(
      `SELECT id FROM patient_images
       WHERE id IN (${ids.map(() => "?").join(",")}) AND patient_id = ? AND deleted = 0`,
      [...ids, patientId],
    ).catch(() => [] as { id: number }[]);
    const valid = new Set(rows.map((r) => r.id));
    ids = ids.filter((i) => valid.has(i));
  }
  await run("UPDATE prescriptions SET image_ids = ? WHERE id = ?", [ids.length ? JSON.stringify(ids) : null, rxId]);
}

/** The patient is required for every image route — records are scoped to them. */
async function requirePatient(c: Context, id: number): Promise<boolean> {
  if (!id) return false;
  const p = await get("SELECT id FROM patients WHERE id = ?", [id]);
  return Boolean(p);
}

const ImageUploadRequest = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(255),
        type: z.string().max(128),
        size: z.number().int().min(0),
      }),
    )
    .min(1)
    .max(24),
});

const ImageFinalizeInput = z.object({
  files: z
    .array(
      z.object({
        key: z.string().min(1).max(512),
        file_name: z.string().max(255).optional().nullable(),
        mime_type: z.string().min(1).max(128),
        size_bytes: z.number().int().min(0),
        kind: z.enum(IMAGE_KINDS).default("photo"),
        label: z.string().max(200).optional().nullable(),
        appointment_id: z.number().int().nullable().optional(),
        compare_group: z.string().max(64).nullable().optional(),
      }),
    )
    .min(1)
    .max(24),
});

const ImagePatchInput = z.object({
  kind: z.enum(IMAGE_KINDS).optional(),
  label: z.string().max(200).nullable().optional(),
  appointment_id: z.number().int().nullable().optional(),
  compare_group: z.string().max(64).nullable().optional(),
});

/** Issue short-lived presigned PUT URLs the browser uploads straight into. */
app.post("/api/patients/:id/images/uploads", async (c) => {
  const pid = intParam(c.req.param("id"));
  if (!(await requirePatient(c, pid ?? 0)) || !pid) return c.json({ error: "Patient not found" }, 404);
  const parsed = await parseJson(c, ImageUploadRequest);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const settings = await readStorageSettings();
  if (!isStorageConfigured(settings)) {
    return c.json(
      { error: "Image storage is turned off. Enable the built-in database storage or configure a bucket in Settings → Storage." },
      400,
    );
  }
  const dbMode = isDbStorage(settings);
  const maxBytes = (dbMode ? DB_STORAGE_MAX_MB : settings.maxFileMb) * 1024 * 1024;
  for (const f of parsed.data.files) {
    if (!IMAGE_MIME_TYPES.has(f.type) && !f.type.startsWith("image/")) {
      return c.json({ error: `"${f.name}": unsupported file type "${f.type}". Use an image file or DICOM.` }, 400);
    }
    if (f.size > maxBytes) {
      const limit = dbMode ? DB_STORAGE_MAX_MB : settings.maxFileMb;
      return c.json(
        { error: `"${f.name}" is ${(f.size / 1024 / 1024).toFixed(1)} MB — the limit is ${limit} MB${dbMode ? " for built-in database storage (configure a bucket for bigger files)" : ""}.` },
        413,
      );
    }
  }

  const uploads: Array<{ key: string; upload_url: string; headers: Record<string, string>; expires_at: string }> = [];
  for (const f of parsed.data.files) {
    const key = newObjectKey(pid, f.name);
    const signed = await presignUpload(key);
    if (!signed) return c.json({ error: "Storage is not configured." }, 400);
    uploads.push({
      key,
      upload_url: signed.url,
      headers: signed.headers,
      expires_at: new Date(Date.now() + settings.expiryMinutes * 60_000).toISOString(),
    });
  }
  return c.json({ uploads });
});

/**
 * Built-in DB storage tier. The browser uploads the raw bytes here; the key is
 * the unguessable object key the uploads route issued (scoped to one patient).
 */
app.put("/api/image-file", async (c) => {
  const key = c.req.query("key") ?? "";
  if (!key || !key.startsWith("patients/")) return c.json({ error: "Invalid file key." }, 400);
  // The upload URL is only issued by /uploads when provider == "db", but let a
  // leftover db-mode upload target stay usable after a bucket is configured.
  const settings = await readStorageSettings();
  if (!isDbStorage(settings)) return c.json({ error: "DB storage is not the active provider." }, 405);

  const body = await c.req.arrayBuffer().catch(() => null);
  const bytes = body ? new Uint8Array(body) : null;
  if (!bytes || bytes.byteLength === 0) return c.json({ error: "Empty body." }, 400);
  const maxBytes = DB_STORAGE_MAX_MB * 1024 * 1024;
  if (bytes.byteLength > maxBytes) {
    return c.json(
      { error: `File is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — the limit for database storage is ${DB_STORAGE_MAX_MB} MB.` },
      413,
    );
  }
  const mime = (c.req.header("content-type") ?? "application/octet-stream").split(";")[0].trim();
  await run(
    `INSERT INTO patient_image_blobs (file_key, mime_type, data) VALUES (?, ?, ?)
     ON CONFLICT(file_key) DO UPDATE SET mime_type = excluded.mime_type, data = excluded.data, created_at = datetime('now')`,
    [key, mime, bytes],
  );
  return c.json({ ok: true }, 201);
});

/** Serve a blob stored in the database (same origin — safe for print/Pdf). */
app.get("/api/image-file", async (c) => {
  const key = c.req.query("key") ?? "";
  const row = await get<{ mime_type: string; data: ArrayBuffer }>(
    "SELECT mime_type, data FROM patient_image_blobs WHERE file_key = ?",
    [key],
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  return new Response(row.data as BodyInit, {
    headers: {
      "Content-Type": row.mime_type,
      "Cache-Control": "private, max-age=3600",
    },
  });
});

/** Register the metadata for files the browser just uploaded. */
app.post("/api/patients/:id/images", async (c) => {
  const pid = intParam(c.req.param("id"));
  if (!(await requirePatient(c, pid ?? 0)) || !pid) return c.json({ error: "Patient not found" }, 404);
  const parsed = await parseJson(c, ImageFinalizeInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const created: Array<Record<string, unknown>> = [];
  for (const f of parsed.data.files) {
    if (!f.key.startsWith(`patients/${pid}/`)) {
      return c.json({ error: "Refusing a file key that isn't scoped to this patient." }, 400);
    }
    if (!IMAGE_MIME_TYPES.has(f.mime_type) && !f.mime_type.startsWith("image/")) {
      return c.json({ error: `Unsupported file type "${f.mime_type}".` }, 400);
    }
    const r = await run(
      `INSERT INTO patient_images
         (patient_id, appointment_id, file_key, file_name, mime_type, size_bytes, kind, label, compare_group, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'))`,
      [
        pid,
        f.appointment_id ?? null,
        f.key,
        f.file_name ?? null,
        f.mime_type,
        f.size_bytes,
        f.kind,
        f.label ?? null,
        f.compare_group ?? null,
      ],
    );
    const row = await get(
      `SELECT id, patient_id, appointment_id, file_key, file_name, mime_type, size_bytes,
              kind, label, compare_group, uploaded_at
       FROM patient_images WHERE id = ?`,
      [Number(r.lastInsertRowid)],
    );
    if (row) created.push({ ...row, url: await storageUrlForFile(String(row.file_key)) });
  }
  return c.json({ images: created }, 201);
});

app.get("/api/patients/:id/images", async (c) => {
  const pid = intParam(c.req.param("id"));
  if (!(await requirePatient(c, pid ?? 0)) || !pid) return c.json({ error: "Patient not found" }, 404);
  const kind = c.req.query("kind");
  const params: unknown[] = [pid];
  let kindClause = "";
  if (kind && IMAGE_KINDS.includes(kind as never)) {
    kindClause = "AND kind = ?";
    params.push(kind);
  }
  const rows = await query(
    `SELECT id, patient_id, appointment_id, file_key, file_name, mime_type, size_bytes,
            kind, label, compare_group, uploaded_at
     FROM patient_images
     WHERE patient_id = ? AND deleted = 0 ${kindClause}
     ORDER BY uploaded_at DESC, id DESC`,
    params,
  ).catch(() => [] as Array<Record<string, unknown>>);
  const settings = await readStorageSettings();
  const images = [];
  for (const r of rows) {
    images.push({ ...r, url: await storageUrlForFile(String(r.file_key)) });
  }
  return c.json({
    images,
    storage: {
      enabled: isStorageConfigured(settings),
      provider: settings.provider,
      max_file_mb: isDbStorage(settings) ? DB_STORAGE_MAX_MB : settings.maxFileMb,
    },
  });
});

app.patch("/api/images/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, ImagePatchInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const existing = await get("SELECT id FROM patient_images WHERE id = ? AND deleted = 0", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of ["kind", "label", "appointment_id", "compare_group"] as const) {
    if (d[key] !== undefined) {
      sets.push(`${key} = ?`);
      params.push(d[key] ?? null);
    }
  }
  if (sets.length) {
    params.push(id);
    await run(`UPDATE patient_images SET ${sets.join(", ")} WHERE id = ?`, params);
  }
  const row = await get(
    `SELECT id, patient_id, appointment_id, file_key, file_name, mime_type, size_bytes,
            kind, label, compare_group, uploaded_at
     FROM patient_images WHERE id = ?`,
    [id],
  );
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ image: { ...row, url: await storageUrlForFile(String(row.file_key)) } });
});

/** Soft-delete: keeps the row (and anything referencing it) intact for audit. */
app.delete("/api/images/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("UPDATE patient_images SET deleted = 1 WHERE id = ? AND deleted = 0", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

/**
 * Auto-fill context for the prescription form: the tooth the patient is being
 * treated on right now (latest open plan item) and their recent X-ray images,
 * so the doctor can attach them without digging through the gallery.
 */
app.get("/api/patients/:id/prescription-context", async (c) => {
  const pid = intParam(c.req.param("id"));
  if (!(await requirePatient(c, pid ?? 0)) || !pid) return c.json({ error: "Patient not found" }, 404);

  const planned = await get<{ tooth: string }>(
    `SELECT tooth FROM treatment_plan_items
     WHERE patient_id = ? AND tooth IS NOT NULL AND tooth != '' AND status IN ('planned', 'accepted')
     ORDER BY id DESC LIMIT 1`,
    [pid],
  );
  const anyTooth = planned ?? (await get<{ tooth: string }>(
    `SELECT tooth FROM treatment_plan_items
     WHERE patient_id = ? AND tooth IS NOT NULL AND tooth != ''
     ORDER BY id DESC LIMIT 1`,
    [pid],
  ));

  const settings = await readStorageSettings();
  const rows = await query(
    `SELECT id, patient_id, appointment_id, file_key, file_name, mime_type, size_bytes,
            kind, label, compare_group, uploaded_at
     FROM patient_images
     WHERE patient_id = ? AND deleted = 0 AND kind != 'photo'
     ORDER BY uploaded_at DESC, id DESC LIMIT 8`,
    [pid],
  ).catch(() => [] as Array<Record<string, unknown>>);
  const images = [];
  for (const r of rows) {
    images.push({ ...r, url: await storageUrlForFile(String(r.file_key)) });
  }
  return c.json({ tooth: anyTooth?.tooth ?? null, images, storage: { enabled: isStorageConfigured(settings) } });
});

// ── Storage configuration (Settings → Storage) ────────────────────

app.get("/api/storage/config", async (c) => c.json(await storageStatus()));

const StorageInput = z.object({
  provider: z.enum(["none", "db", "s3", "r2"]),
  endpoint: z.string().max(512).optional(),
  region: z.string().max(64).optional(),
  bucket: z.string().max(255).optional(),
  access_key_id: z.string().max(255).optional(),
  // Empty / the masked placeholder = keep the stored secret.
  secret_access_key: z.string().max(512).optional(),
  keep_secret: z.boolean().optional(),
  public_base_url: z.string().max(512).optional().nullable(),
  expiry_minutes: z.number().int().min(1).max(60).optional(),
  max_file_mb: z.number().int().min(1).max(200).optional(),
});

app.put("/api/storage/config", async (c) => {
  const parsed = await parseJson(c, StorageInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const err = validateStorageInput({ ...d, keep_secret: d.keep_secret });
  if (err) return c.json({ error: err }, 400);

  const entries: Array<[string, string | null]> = [
    ["storage_provider", d.provider],
    ["storage_endpoint", d.endpoint ?? ""],
    ["storage_region", d.region ?? ""],
    ["storage_bucket", d.bucket ?? ""],
    ["storage_access_key_id", d.access_key_id ?? ""],
    ["storage_public_base_url", d.public_base_url ?? ""],
  ];
  if (d.expiry_minutes !== undefined) entries.push(["storage_expiry_minutes", String(d.expiry_minutes)]);
  if (d.max_file_mb !== undefined) entries.push(["storage_max_file_mb", String(d.max_file_mb)]);

  const secret = (d.secret_access_key ?? "").trim();
  if (secret && secret !== "••••••••") entries.push(["storage_secret_access_key", secret]);
  else if (d.provider === "none") entries.push(["storage_secret_access_key", ""]);

  for (const [key, value] of entries) {
    await run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, value ?? ""],
    );
  }
  return c.json(await storageStatus());
});

// ── Inventory (stock control & supplier tracking) ────────────────

const InventoryItemInput = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  unit: z.string().optional(),
  current_stock: z.number().int().min(0).optional(),
  min_threshold: z.number().int().min(0).optional(),
  reorder_quantity: z.number().int().min(1).optional().nullable(),
  supplier_name: z.string().optional().nullable(),
  supplier_contact: z.string().optional().nullable(),
  batch_number: z.string().optional().nullable(),
  expiry_date: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  unit_cost: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
});

// Fall back to [] when the inventory tables don't exist yet (pre-migration
// dev DB), the same way the insurance/lab routes do.
const safeQueryItems = <T,>(sql: string, params: unknown[] = []): Promise<T[]> =>
  query<T>(sql, params).catch(() => [] as T[]);

app.get("/api/inventory", async (c) => {
  const q = c.req.query("q")?.trim().toLowerCase();
  const status = c.req.query("status");
  const category = c.req.query("category");
  // TODO could be a query param later; every item with an expiry_date is checked.
  let where = "active = 1";
  const params: unknown[] = [];
  if (q) {
    // Filter the already-meterialized rows in JS — FTS handles the "did you
    // mean" global search already. A LIKE on a few hundred rows is fine.
    where += " AND (name LIKE ? OR sku LIKE ? OR supplier_name LIKE ? OR batch_number LIKE ? OR category LIKE ?)";
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  if (category) { where += " AND COALESCE(category,'') = ?"; params.push(category); }
  let rows = await safeQueryItems<InventoryItemRow>(
    `SELECT * FROM inventory_items WHERE ${where} ORDER BY name COLLATE NOCASE`,
    params,
  );
  // status filter in JS: today's date for the expiry window is fetched with the items.
  if (status) {
    const today = new Date().toISOString().slice(0, 10);
    const { expiryDays } = await getInventorySettings();
    const cutoff = datePlusDays(today, expiryDays);
    rows = rows.filter((it) => {
      if (status === "out_of_stock") return it.current_stock === 0;
      if (status === "low_stock") return it.current_stock > 0 && it.current_stock <= it.min_threshold;
      if (status === "expiring") return it.expiry_date != null && it.expiry_date > today && it.expiry_date <= cutoff;
      if (status === "expired") return it.expiry_date != null && it.expiry_date <= today;
      return true;
    });
  }
  return c.json({ items: rows, categories: INVENTORY_CATEGORIES });
});

// Registered before the /inventory/:id routes so the static segment wins.
app.get("/api/inventory/settings", async (c) => {
  const { expiryDays, alertEmail } = await getInventorySettings();
  return c.json({ settings: { inventory_expiry_alert_days: String(expiryDays), inventory_alert_email: alertEmail } });
});

app.put("/api/inventory/settings", async (c) => {
  const parsed = await parseJson(
    c,
    z.object({
      inventory_expiry_alert_days: z.number().int().min(0).max(3650).optional(),
      inventory_alert_email: z.string().email().optional().or(z.literal("")),
    }),
  );
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const updates: [string, string][] = [];
  if (parsed.data.inventory_expiry_alert_days !== undefined) updates.push(["inventory_expiry_alert_days", String(parsed.data.inventory_expiry_alert_days)]);
  if (parsed.data.inventory_alert_email !== undefined) updates.push(["inventory_alert_email", parsed.data.inventory_alert_email.trim()]);
  for (const [key, value] of updates) {
    await run(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }
  const { expiryDays, alertEmail } = await getInventorySettings();
  return c.json({ settings: { inventory_expiry_alert_days: String(expiryDays), inventory_alert_email: alertEmail } });
});

app.post("/api/inventory", async (c) => {
  const parsed = await parseJson(c, InventoryItemInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO inventory_items
       (name, category, sku, unit, current_stock, min_threshold, reorder_quantity,
        supplier_name, supplier_contact, batch_number, expiry_date, location, unit_cost, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.name.trim(), d.category?.trim() || null, d.sku?.trim() || null, d.unit ?? "piece",
      d.current_stock ?? 0, d.min_threshold ?? 0, d.reorder_quantity ?? null,
      d.supplier_name?.trim() || null, d.supplier_contact?.trim() || null, d.batch_number?.trim() || null,
      d.expiry_date || null, d.location?.trim() || null, d.unit_cost ?? 0, d.notes?.trim() || null,
    ],
  );
  const item = await get(
    "SELECT * FROM inventory_items WHERE id = ?", [result.lastInsertRowid],
  );
  return c.json({ item }, 201);
});

app.put("/api/inventory/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, InventoryItemInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v === undefined) continue;
    // Blank strings are cleared to NULL for the free-text fields.
    const normalized = ["category", "sku", "supplier_name", "supplier_contact", "batch_number", "expiry_date", "location", "notes", "unit"]
      .includes(k) && typeof v === "string" && v.trim() === "" ? null : v;
    sets.push(`${k} = ?`);
    params.push(normalized);
  }
  sets.push("updated_at = datetime('now')");
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE inventory_items SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const item = await get("SELECT * FROM inventory_items WHERE id = ?", [id]);
  return c.json({ item });
});

app.delete("/api/inventory/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("UPDATE inventory_items SET active = 0, updated_at = datetime('now') WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

/** Reports a stock movement and keeps `current_stock` in sync. */
async function applyMovement(
  id: number,
  type: "in" | "out" | "adjust",
  quantity: number,
  balanceAfter: number,
  opts: Record<string, unknown>,
): Promise<boolean> {
  const r = await run(
    `INSERT INTO inventory_movements (item_id, type, quantity, balance_after, unit_cost, reference, reason, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, type, quantity, balanceAfter, opts.unit_cost ?? null, opts.reference ?? null, opts.reason ?? null, opts.notes ?? null],
  );
  if (!r.changes) return false;
  await run("UPDATE inventory_items SET current_stock = ?, updated_at = datetime('now') WHERE id = ?", [balanceAfter, id]);
  return true;
}

const StockInInput = z.object({
  quantity: z.number().int().positive(),
  unit_cost: z.number().min(0).optional().nullable(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const StockOutInput = z.object({
  quantity: z.number().int().positive(),
  reason: z.string().optional().nullable(),
  reference: z.string().optional().nullable(),
  allow_negative: z.boolean().optional(),
  notes: z.string().optional().nullable(),
});

const AdjustInput = z.object({
  new_stock: z.number().int().min(0),
  reason: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

app.post("/api/inventory/:id/stock-in", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, StockInInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const item = await get<InventoryItemRow>("SELECT * FROM inventory_items WHERE id = ? AND active = 1", [id]);
  if (!item) return c.json({ error: "Item not found" }, 404);
  const qty = parsed.data.quantity;
  const balance = (item.current_stock ?? 0) + qty;
  // Restock also refreshes the unit cost used for valuation.
  if (parsed.data.unit_cost != null) {
    await run("UPDATE inventory_items SET unit_cost = ?, updated_at = datetime('now') WHERE id = ?", [parsed.data.unit_cost, id]);
  }
  await applyMovement(id, "in", qty, balance, parsed.data);
  const updated = await get("SELECT * FROM inventory_items WHERE id = ?", [id]);
  return c.json({ item: updated, movement: { item_id: id, type: "in", quantity: qty, balance_after: balance } }, 201);
});

app.post("/api/inventory/:id/stock-out", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, StockOutInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const item = await get<InventoryItemRow>("SELECT * FROM inventory_items WHERE id = ? AND active = 1", [id]);
  if (!item) return c.json({ error: "Item not found" }, 404);
  const qty = parsed.data.quantity;
  const balance = (item.current_stock ?? 0) - qty;
  if (balance < 0 && !parsed.data.allow_negative) {
    return c.json({ error: `Only ${item.current_stock} ${item.unit} in stock — can't issue ${qty}. Enable “allow negative” to oversell.` }, 400);
  }
  await applyMovement(id, "out", qty, balance, parsed.data);
  const updated = await get("SELECT * FROM inventory_items WHERE id = ?", [id]);
  return c.json({ item: updated, movement: { item_id: id, type: "out", quantity: qty, balance_after: balance } }, 201);
});

app.post("/api/inventory/:id/adjust", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, AdjustInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const item = await get<InventoryItemRow>("SELECT * FROM inventory_items WHERE id = ? AND active = 1", [id]);
  if (!item) return c.json({ error: "Item not found" }, 404);
  const delta = parsed.data.new_stock - (item.current_stock ?? 0);
  await applyMovement(id, "adjust", Math.abs(delta), parsed.data.new_stock, parsed.data);
  const updated = await get("SELECT * FROM inventory_items WHERE id = ?", [id]);
  return c.json({ item: updated }, 201);
});

app.get("/api/inventory/:id/movements", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rows = await safeQueryItems<Record<string, unknown>>(
    "SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY performed_at DESC, id DESC LIMIT 200",
    [id],
  );
  return c.json({ movements: rows });
});

// Open alerts (resolved = 0) joined with item names; lives before the :id rule
// is irrelevant — nested path, static segment wins.
app.get("/api/inventory/alerts", async (c) => {
  const rows = await safeQueryItems<Record<string, unknown>>(
    `SELECT a.*, i.name as item_name
     FROM inventory_alerts a LEFT JOIN inventory_items i ON i.id = a.item_id
     WHERE a.resolved = 0
     ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, a.id DESC`,
  );
  return c.json({ alerts: rows });
});

app.post("/api/inventory/alerts/:id/resolve", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(
    "UPDATE inventory_alerts SET resolved = 1, resolved_at = datetime('now') WHERE id = ? AND resolved = 0",
    [id],
  );
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(
    `SELECT a.*, i.name as item_name FROM inventory_alerts a LEFT JOIN inventory_items i ON i.id = a.item_id WHERE a.id = ?`,
    [id],
  );
  return c.json({ alert: row });
});

// The daily scan: rebuild the open-alert set from the current stock/expiry
// state. Client-orchestrated (see use-daily-inventory-scan), but also callable
// from a cron trigger later or the "Scan now" button.
app.post("/api/inventory/scan", async (c) => {
  const result = await runInventoryScan();
  return c.json(result, 200);
});

// ── Search ────────────────────────────────────────────────────────

app.get("/api/search", async (c) => {
  const q = c.req.query("q")?.trim() ?? "";
  if (!q) return c.json({ hits: [], via: "fts5" });
  const limitParam = intParam(c.req.query("limit") ?? undefined);
  const limit = limitParam ? Math.min(limitParam, 100) : 60;
  const { hits, via } = await searchAll(q, limit);
  return c.json({ hits, via });
});

// Manual full rebuild of the search index (recovery from drift or corruption).
app.post("/api/search/reindex", async (c) => {
  const counts = await reindexSearchIndex();
  return c.json({ ok: true, counts });
});

// ── Health ─────────────────────────────────────────────────────────

app.get("/api/health", (c) => c.json({ ok: true }));

export default app;
