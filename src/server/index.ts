import { type Context } from "hono";
import { z } from "zod";
import { createApp } from "@clawnify/app";
import { query, get, run } from "./db";
import {
  DEFAULT_BACKUP_SETTINGS,
  DEFAULT_PROFILE_SETTINGS,
  DEFAULT_SETTINGS,
  SEED_DENTIST_NOTES,
  SEED_OPERATORIES,
  SEED_PRACTITIONERS,
  SEED_TREATMENT_TYPES,
} from "./seed";
import { reindexSearchIndex, searchAll } from "./search";
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

type SeedTable = "operatories" | "practitioners" | "treatment_types" | "dentist_notes";

let seeded = false;
let seeding: Promise<void> | null = null;

async function isEmpty(table: SeedTable): Promise<boolean> {
  const row = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`);
  return (row?.n ?? 0) === 0;
}

async function seedOnce(): Promise<void> {
  for (const [key, value] of Object.entries({ ...DEFAULT_SETTINGS, ...DEFAULT_PROFILE_SETTINGS, ...DEFAULT_BACKUP_SETTINGS })) {
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

app.use("*", async (_c, next) => {
  await ensureSeeded();
  await next();
});

// ── Helpers ────────────────────────────────────────────────────────

const intParam = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

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
  template: z.enum(["classic", "modern", "compact", "elegant", "minimal", "bold", "watermark"]).optional(),
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

function newShareToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Letterhead fields for a printable/shared prescription sheet. */
async function getSettingsForPrescription() {
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM settings WHERE key IN ('doctor_name','doctor_specialty','doctor_license','clinic_name','clinic_address','doctor_phone')",
  ).catch(() => [] as { key: string; value: string }[]);
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return {
    doctor_name: map.doctor_name || "Doctor",
    doctor_specialty: map.doctor_specialty || "Dentist",
    doctor_license: map.doctor_license || "",
    clinic_name: map.clinic_name || "",
    clinic_address: map.clinic_address || "",
    doctor_phone: map.doctor_phone || "",
  };
}

async function loadPrescription(id: number) {
  const rx = await get(`
    SELECT rx.*, pr.name as practitioner_name, pr.role as practitioner_role,
           p.first_name as patient_first_name, p.last_name as patient_last_name,
           p.date_of_birth as patient_date_of_birth, p.medical_alerts as patient_medical_alerts
    FROM prescriptions rx
    LEFT JOIN practitioners pr ON pr.id = rx.practitioner_id
    LEFT JOIN patients p ON p.id = rx.patient_id
    WHERE rx.id = ?
  `, [id]);
  if (!rx) return null;
  const items = await query(
    "SELECT * FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order, id",
    [id],
  );
  return { ...rx, items };
}

app.get("/api/patients/:id/prescriptions", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rows = await query(
    `SELECT rx.*, pr.name as practitioner_name,
            (SELECT COUNT(*) FROM prescription_items ri WHERE ri.prescription_id = rx.id) as item_count
     FROM prescriptions rx
     LEFT JOIN practitioners pr ON pr.id = rx.practitioner_id
     WHERE rx.patient_id = ?
     ORDER BY rx.issued_date DESC, rx.id DESC`,
    [id],
  );
  return c.json({ prescriptions: rows });
});

app.get("/api/prescriptions/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rx = await loadPrescription(id);
  if (!rx) return c.json({ error: "Not found" }, 404);
  return c.json({ prescription: rx });
});

app.post("/api/prescriptions", async (c) => {
  const parsed = await parseJson(c, PrescriptionInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO prescriptions (patient_id, practitioner_id, issued_date, template, diagnosis, advice, follow_up)
     VALUES (?, ?, COALESCE(?, date('now')), ?, ?, ?, ?)`,
    [
      d.patient_id,
      d.practitioner_id ?? null,
      d.issued_date ?? null,
      d.template ?? "classic",
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
  const rx = await loadPrescription(rxId);
  return c.json({ prescription: rx }, 201);
});

app.put("/api/prescriptions/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, PrescriptionUpdateInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const existing = await get("SELECT id FROM prescriptions WHERE id = ?", [id]);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of ["practitioner_id", "issued_date", "template", "diagnosis", "advice", "follow_up"] as const) {
    const v = d[key];
    if (v !== undefined) {
      sets.push(`${key} = ?`);
      params.push(v ?? null);
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

// Share management: create/rotate the public link, or revoke it.
app.post("/api/prescriptions/:id/share", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const token = newShareToken();
  const r = await run(
    "UPDATE prescriptions SET share_token = ?, share_revoked = 0 WHERE id = ?",
    [token, id],
  );
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ share_token: token });
});

app.delete("/api/prescriptions/:id/share", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run(
    "UPDATE prescriptions SET share_token = NULL, share_revoked = 0 WHERE id = ?",
    [id],
  );
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// Public read-only view. No auth: access is by unguessable 128-bit token and
// the token can be revoked at any time. Deliberately returns only what the
// prescription sheet needs — no practice-wide data, no patient contact fields.
app.get("/api/public/prescriptions/:token", async (c) => {
  const token = c.req.param("token");
  if (!token || token.length < 16) return c.json({ error: "Not found" }, 404);
  const rx = await get(`
    SELECT rx.id, rx.issued_date, rx.template, rx.diagnosis, rx.advice, rx.follow_up,
           pr.name as practitioner_name,
           p.first_name as patient_first_name, p.last_name as patient_last_name,
           p.date_of_birth as patient_date_of_birth
    FROM prescriptions rx
    LEFT JOIN practitioners pr ON pr.id = rx.practitioner_id
    LEFT JOIN patients p ON p.id = rx.patient_id
    WHERE rx.share_token = ? AND rx.share_revoked = 0
  `, [token]);
  if (!rx) return c.json({ error: "Not found" }, 404);
  const items = await query(
    "SELECT drug_name, dosage, frequency, duration, instructions FROM prescription_items WHERE prescription_id = ? ORDER BY sort_order, id",
    [rx.id],
  );
  // Letterhead fields are part of the document itself, so they ride along;
  // everything else about the practice stays private.
  const letterhead = await getSettingsForPrescription();
  return c.json({ prescription: { ...rx, items, practice: letterhead } });
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
    }>(
      `SELECT
         (SELECT MAX(substr(start_time, 1, 10)) FROM appointments
          WHERE patient_id = ? AND status = 'completed') as last_checked,
         (SELECT body FROM clinical_notes WHERE patient_id = ? ORDER BY note_date DESC LIMIT 1) as observation,
         (SELECT GROUP_CONCAT(DISTINCT tc.condition) FROM tooth_conditions tc WHERE tc.patient_id = ?) as prescription`,
      [id, id, id],
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

app.get("/api/settings", async (c) => {
  const rows = await query<{ key: string; value: string }>(
    "SELECT key, value FROM settings",
  ).catch(() => []);
  const out: Record<string, string> = { ...DEFAULT_SETTINGS, ...DEFAULT_PROFILE_SETTINGS, ...DEFAULT_BACKUP_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return c.json({ settings: out });
});

app.put("/api/settings", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "Body must be an object" }, 400);
  const entries = Object.entries(body as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null);
  for (const [key, value] of entries) {
    await run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, String(value)],
    );
  }
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: Record<string, string> = { ...DEFAULT_SETTINGS, ...DEFAULT_PROFILE_SETTINGS, ...DEFAULT_BACKUP_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return c.json({ settings: out });
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
