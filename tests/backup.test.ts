import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, freshApp, jsonRequest, type TestContext } from "./helpers";

let ctx: TestContext;
let app: Awaited<ReturnType<typeof freshApp>>;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.dispose();
});

beforeEach(async () => {
  await ctx.resetDb();
  app = await freshApp();
});

// Prime the first-request seed so lookups exist.
async function prime() {
  await app.request("/api/health", undefined, { DB: ctx.db });
}

async function seedPracticeData() {
  await prime();
  const { path, init } = jsonRequest("POST", "/api/patients", {
    first_name: "Import",
    last_name: "Tester",
    email: "import@example.test",
    phone: "555-0100",
  });
  const res = await app.request(path, init, { DB: ctx.db });
  expect(res.status).toBe(201);
  const { patient } = (await res.json()) as { patient: { id: number } };

  const note = jsonRequest("POST", "/api/clinical-notes", {
    patient_id: patient.id,
    body: "Pre-import clinical note",
  });
  await app.request(note.path, note.init, { DB: ctx.db });

  const ops = await app.request("/api/operatories", undefined, { DB: ctx.db });
  const { operatories } = (await ops.json()) as { operatories: { id: number }[] };

  const appt = jsonRequest("POST", "/api/appointments", {
    patient_id: patient.id,
    operatory_id: operatories[0].id,
    start_time: "2026-09-18T09:00:00",
    end_time: "2026-09-18T09:30:00",
    status: "completed",
  });
  const apptRes = await app.request(appt.path, appt.init, { DB: ctx.db });
  expect(apptRes.status).toBe(201);
  return patient.id;
}

async function fetchExport(): Promise<Record<string, unknown>> {
  const res = await app.request("/api/backup/export", undefined, { DB: ctx.db });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Disposition")).toContain("attachment");
  return (await res.json()) as Record<string, unknown>;
}

describe("GET /api/backup/export", () => {
  it("dumps every data table with format metadata", async () => {
    await seedPracticeData();
    const payload = (await fetchExport()) as {
      format: string;
      version: number;
      created_at: string;
      tables: Record<string, unknown[]>;
    };

    expect(payload.format).toBe("dental-canvas-backup");
    expect(typeof payload.version).toBe("number");
    expect(payload.created_at).toBeTruthy();

    // Every data table must be present (empty or not).
    for (const table of [
      "settings",
      "operatories",
      "practitioners",
      "treatment_types",
      "patients",
      "appointments",
      "clinical_notes",
      "dentist_notes",
    ]) {
      expect(Array.isArray(payload.tables[table])).toBe(true);
    }

    expect(payload.tables.patients).toHaveLength(1);
    expect(payload.tables.appointments).toHaveLength(1);
    // Derived data is excluded.
    expect(payload.tables.search_index).toBeUndefined();
    expect(payload.tables.backups).toBeUndefined();
  });

  it("captures settings including profile and backup keys", async () => {
    await seedPracticeData();
    const put = await app.request(
      "/api/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_name: "Sarah", auto_backup_interval_minutes: "60" }),
      },
      { DB: ctx.db },
    );
    expect(put.status).toBe(200);

    const payload = (await fetchExport()) as { tables: { settings: { key: string; value: string }[] } };
    const settings = Object.fromEntries(payload.tables.settings.map((r) => [r.key, r.value]));
    expect(settings.doctor_name).toBe("Sarah");
    expect(settings.auto_backup_interval_minutes).toBe("60");
  });
});

describe("POST /api/backup/import", () => {
  it("round-trips: export → wipe → import restores identical data", async () => {
    await seedPracticeData();
    const original = (await fetchExport()) as {
      tables: Record<string, { id: number }[]>;
    };

    // Simulate data loss: wipe the source tables directly.
    for (const table of ["appointments", "clinical_notes", "patients"]) {
      await ctx.db.prepare(`DELETE FROM ${table}`).run();
    }
    const afterWipe = await app.request("/api/patients", undefined, { DB: ctx.db });
    expect(((await afterWipe.json()) as { patients: unknown[] }).patients).toHaveLength(0);

    // Import the saved export.
    const imp = await app.request(
      "/api/backup/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(original),
      },
      { DB: ctx.db },
    );
    expect(imp.status).toBe(200);
    const impData = (await imp.json()) as { ok: boolean; imported_rows: number };
    expect(impData.ok).toBe(true);
    expect(impData.imported_rows).toBeGreaterThan(0);

    // Verify the data came back with the SAME ids (FK integrity).
    const patients = await app.request("/api/patients", undefined, { DB: ctx.db });
    const patientsData = (await patients.json()) as { patients: { id: number; last_name: string }[] };
    expect(patientsData.patients).toHaveLength(1);
    expect(patientsData.patients[0].id).toBe(original.tables.patients[0].id);
    expect(patientsData.patients[0].last_name).toBe("Tester");

    const appts = await app.request("/api/appointments", undefined, { DB: ctx.db });
    const apptsData = (await appts.json()) as { appointments: { patient_id: number }[] };
    expect(apptsData.appointments).toHaveLength(1);
    expect(apptsData.appointments[0].patient_id).toBe(original.tables.patients[0].id);
  });

  it("takes a pre-import safety snapshot automatically", async () => {
    await seedPracticeData();
    const before = (await fetchExport()) as { tables: Record<string, unknown[]> };

    const imp = await app.request(
      "/api/backup/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(before),
      },
      { DB: ctx.db },
    );
    expect(imp.status).toBe(200);

    const snaps = await app.request("/api/backup/snapshots", undefined, { DB: ctx.db });
    const snapsData = (await snaps.json()) as { snapshots: { trigger: string }[] };
    expect(snapsData.snapshots.some((s) => s.trigger === "pre-import")).toBe(true);
  });

  it("rejects non-backup JSON and wrong versions", async () => {
    await prime();

    const notBackup = await app.request(
      "/api/backup/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hello: "world" }),
      },
      { DB: ctx.db },
    );
    expect(notBackup.status).toBe(400);

    const futureVersion = await app.request(
      "/api/backup/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "dental-canvas-backup", version: 999, tables: {} }),
      },
      { DB: ctx.db },
    );
    expect(futureVersion.status).toBe(400);

    const broken = await app.request(
      "/api/backup/import",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" },
      { DB: ctx.db },
    );
    expect(broken.status).toBe(400);
  });
});

describe("POST /api/backup/inspect", () => {
  it("previews a backup without importing", async () => {
    await seedPracticeData();
    const original = await fetchExport();

    // Change data after the export — inspect must show the OLD counts.
    const { path, init } = jsonRequest("POST", "/api/patients", {
      first_name: "Second",
      last_name: "Patient",
    });
    await app.request(path, init, { DB: ctx.db });

    const res = await app.request(
      "/api/backup/inspect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(original),
      },
      { DB: ctx.db },
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean; counts: Record<string, number> };
    expect(data.ok).toBe(true);
    expect(data.counts.patients).toBe(1);
    expect(data.counts.appointments).toBe(1);
  });

  it("rejects invalid files", async () => {
    await prime();
    const res = await app.request(
      "/api/backup/inspect",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "[]" },
      { DB: ctx.db },
    );
    expect(res.status).toBe(400);
  });
});

describe("snapshots", () => {
  it("creates a manual snapshot with table counts", async () => {
    await seedPracticeData();
    const res = await app.request("/api/backup/snapshots", { method: "POST" }, { DB: ctx.db });
    expect(res.status).toBe(201);
    const { snapshot } = (await res.json()) as {
      snapshot: { id: number; trigger: string; table_counts: Record<string, number>; size_bytes: number };
    };
    expect(snapshot.trigger).toBe("user");
    expect(snapshot.table_counts.patients).toBe(1);
    expect(snapshot.size_bytes).toBeGreaterThan(0);
  });

  it("downloads a snapshot payload that passes validation", async () => {
    await seedPracticeData();
    const created = await app.request("/api/backup/snapshots", { method: "POST" }, { DB: ctx.db });
    const { snapshot } = (await created.json()) as { snapshot: { id: number } };

    const dl = await app.request(`/api/backup/snapshots/${snapshot.id}`, undefined, { DB: ctx.db });
    expect(dl.status).toBe(200);
    const payload = (await dl.json()) as { format: string; tables: Record<string, unknown[]> };
    expect(payload.format).toBe("dental-canvas-backup");
    expect(Array.isArray(payload.tables.patients)).toBe(true);
  });

  it("deletes a snapshot", async () => {
    await seedPracticeData();
    const created = await app.request("/api/backup/snapshots", { method: "POST" }, { DB: ctx.db });
    const { snapshot } = (await created.json()) as { snapshot: { id: number } };

    const del = await app.request(`/api/backup/snapshots/${snapshot.id}`, { method: "DELETE" }, { DB: ctx.db });
    expect(del.status).toBe(200);

    const gone = await app.request(`/api/backup/snapshots/${snapshot.id}`, undefined, { DB: ctx.db });
    expect(gone.status).toBe(404);
  });

  it("restores from a stored snapshot", async () => {
    await seedPracticeData();
    const created = await app.request("/api/backup/snapshots", { method: "POST" }, { DB: ctx.db });
    const { snapshot } = (await created.json()) as { snapshot: { id: number } };

    // Delete the patient, then roll back.
    const patients = await app.request("/api/patients", undefined, { DB: ctx.db });
    const { patients: list } = (await patients.json()) as { patients: { id: number }[] };
    await app.request(`/api/patients/${list[0].id}`, { method: "DELETE" }, { DB: ctx.db });

    const restore = await app.request(
      `/api/backup/snapshots/${snapshot.id}/restore`,
      { method: "POST" },
      { DB: ctx.db },
    );
    expect(restore.status).toBe(200);

    const after = await app.request("/api/patients", undefined, { DB: ctx.db });
    expect(((await after.json()) as { patients: unknown[] }).patients).toHaveLength(1);

    // And the restore itself left a pre-restore safety snapshot.
    const snaps = await app.request("/api/backup/snapshots", undefined, { DB: ctx.db });
    const snapsData = (await snaps.json()) as { snapshots: { trigger: string }[] };
    expect(snapsData.snapshots.some((s) => s.trigger === "pre-restore")).toBe(true);
  });
});

describe("auto-backup", () => {
  it("is disabled by default (interval 0) and skips when disabled", async () => {
    await prime();
    const settings = await app.request("/api/backup/settings", undefined, { DB: ctx.db });
    const settingsData = (await settings.json()) as { settings: { auto_backup_interval_minutes: number; auto_backup_keep: number } };
    expect(settingsData.settings.auto_backup_interval_minutes).toBe(0);
    expect(settingsData.settings.auto_backup_keep).toBe(10);

    const res = await app.request("/api/backup/auto", { method: "POST" }, { DB: ctx.db });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { skipped: boolean };
    expect(data.skipped).toBe(true);
  });

  it("creates an auto snapshot when enabled", async () => {
    await prime();
    const put = await app.request(
      "/api/backup/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_backup_interval_minutes: 60, auto_backup_keep: 3 }),
      },
      { DB: ctx.db },
    );
    expect(put.status).toBe(200);

    const res = await app.request("/api/backup/auto", { method: "POST" }, { DB: ctx.db });
    expect(res.status).toBe(201);
    const { snapshot } = (await res.json()) as { snapshot: { kind: string; trigger: string } };
    expect(snapshot.kind).toBe("auto");
    expect(snapshot.trigger).toBe("timer");
  });

  it("prunes old auto snapshots, keeping the configured number", async () => {
    await seedPracticeData();
    // Enable auto-backup (interval > 0) — otherwise /api/backup/auto skips.
    await app.request(
      "/api/backup/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_backup_interval_minutes: 60, auto_backup_keep: 2 }),
      },
      { DB: ctx.db },
    );

    // Four auto snapshots back-to-back.
    for (let i = 0; i < 4; i++) {
      const res = await app.request("/api/backup/auto", { method: "POST" }, { DB: ctx.db });
      expect(res.status).toBe(201);
    }

    const snaps = await app.request("/api/backup/snapshots", undefined, { DB: ctx.db });
    const snapsData = (await snaps.json()) as { snapshots: { kind: string }[]; stats: { count: number } };
    const autoCount = snapsData.snapshots.filter((s) => s.kind === "auto").length;
    expect(autoCount).toBeLessThanOrEqual(2);
  });

  it("persists schedule settings across a simulated redeploy", async () => {
    await prime();
    await app.request(
      "/api/backup/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_backup_interval_minutes: 30, auto_backup_keep: 5 }),
      },
      { DB: ctx.db },
    );

    const app2 = await freshApp();
    await app2.request("/api/health", undefined, { DB: ctx.db });
    const res = await app2.request("/api/backup/settings", undefined, { DB: ctx.db });
    const data = (await res.json()) as { settings: { auto_backup_interval_minutes: number; auto_backup_keep: number } };
    expect(data.settings.auto_backup_interval_minutes).toBe(30);
    expect(data.settings.auto_backup_keep).toBe(5);
  });

  it("validates bounds on schedule updates", async () => {
    await prime();
    const res = await app.request(
      "/api/backup/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_backup_interval_minutes: -5 }),
      },
      { DB: ctx.db },
    );
    expect(res.status).toBe(400);
  });
});

// ── Patient image bytes (v3 base64 blob transport) ─────────────────

/** Upload one real image through the live API (db storage is the default). */
async function uploadImage(patientId: number, bytes: Uint8Array): Promise<{ key: string; id: number }> {
  const upReq = jsonRequest("POST", `/api/patients/${patientId}/images/uploads`, {
    files: [{ name: "xray.jpg", type: "image/jpeg", size: bytes.byteLength }],
  });
  const upRes = await app.request(upReq.path, upReq.init, { DB: ctx.db });
  expect(upRes.status).toBe(200);
  const { uploads } = (await upRes.json()) as { uploads: { key: string; upload_url: string }[] };
  const key = uploads[0].key;

  // db-mode upload_url is a relative /api/image-file URL on the same app.
  const putUrl = new URL(uploads[0].upload_url, "http://localhost");
  const put = await app.request(
    `${putUrl.pathname}${putUrl.search}`,
    { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: bytes.buffer as ArrayBuffer },
    { DB: ctx.db },
  );
  expect(put.status).toBe(201);

  const finReq = jsonRequest("POST", `/api/patients/${patientId}/images`, {
    files: [{ key, mime_type: "image/jpeg", size_bytes: bytes.byteLength, kind: "xray", label: "PA 36" }],
  });
  const finRes = await app.request(finReq.path, finReq.init, { DB: ctx.db });
  expect(finRes.status).toBe(201);
  const { images } = (await finRes.json()) as { images: { id: number }[] };
  return { key, id: images[0].id };
}

async function rawBlobRow(key: string): Promise<{ data: unknown; mime_type: string } | null> {
  return await ctx.db
    .prepare("SELECT data, mime_type FROM patient_image_blobs WHERE file_key = ?")
    .bind(key)
    .first<{ data: unknown; mime_type: string }>();
}

describe("backup includes patient image bytes", () => {
  it("exports image blobs as decodable base64 and round-trips them through import", async () => {
    const pid = await seedPracticeData();
    const imageBytes = new Uint8Array(1024).map((_, i) => i % 251); // non-trivial binary
    const img = await uploadImage(pid, imageBytes);

    const payload = (await fetchExport()) as {
      tables: { patient_image_blobs: { file_key: string; data_base64: string; data?: unknown }[] };
    };

    // The transport column is present and decodes to the exact bytes.
    const rows = payload.tables.patient_image_blobs;
    expect(rows).toHaveLength(1);
    expect(rows[0].file_key).toBe(img.key);
    expect(typeof rows[0].data_base64).toBe("string");
    const decoded = Uint8Array.from(atob(rows[0].data_base64), (ch) => ch.charCodeAt(0));
    expect(decoded).toEqual(imageBytes);
    // No binary field leaks into the JSON as a mangled object.
    expect(rows[0].data).toBeUndefined();

    // Simulate data loss and restore.
    await ctx.db.prepare("DELETE FROM patient_image_blobs").run();
    await ctx.db.prepare("DELETE FROM patient_images").run();
    const imp = await app.request(
      "/api/backup/import",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { DB: ctx.db },
    );
    expect(imp.status).toBe(200);

    // The blob bytes are back, byte for byte, under the same key.
    const row = await rawBlobRow(img.key);
    expect(row).not.toBeNull();
    const restored = row!.data instanceof ArrayBuffer ? new Uint8Array(row!.data) : Uint8Array.from(row!.data as number[]);
    expect(restored).toEqual(imageBytes);
    expect(row!.mime_type).toBe("image/jpeg");

    // And the image is served back intact through the normal endpoint.
    const serve = await app.request(`/api/image-file?key=${encodeURIComponent(img.key)}`, undefined, { DB: ctx.db });
    expect(serve.status).toBe(200);
    expect(new Uint8Array(await serve.arrayBuffer())).toEqual(imageBytes);
  });

  it("includes image blobs in snapshots and their downloads", async () => {
    const pid = await seedPracticeData();
    const imageBytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
    await uploadImage(pid, imageBytes);

    const created = await app.request("/api/backup/snapshots", { method: "POST" }, { DB: ctx.db });
    const { snapshot } = (await created.json()) as { snapshot: { id: number; table_counts: Record<string, number> } };
    expect(snapshot.table_counts.patient_image_blobs).toBe(1);

    const dl = await app.request(`/api/backup/snapshots/${snapshot.id}`, undefined, { DB: ctx.db });
    const payload = (await dl.json()) as { tables: { patient_image_blobs: { data_base64?: string }[] } };
    expect(payload.tables.patient_image_blobs[0].data_base64).toBeTruthy();
  });

  it("skips corrupt blob rows instead of failing the export", async () => {
    const pid = await seedPracticeData();
    await uploadImage(pid, new Uint8Array([9, 8, 7]));
    // Simulate a runtime that materialized the blob into something unusable:
    // X'00' is a valid-but-empty BLOB, which dumpImageBlobs must skip.
    await ctx.db.prepare("UPDATE patient_image_blobs SET data = X''").run();

    const payload = (await fetchExport()) as { tables: { patient_image_blobs: unknown[] } };
    expect(payload.tables.patient_image_blobs).toHaveLength(0);
  });
});

describe("import restores searchability", () => {
  it("search finds imported patients after import", async () => {
    await seedPracticeData();
    const original = await fetchExport();

    // Wipe + import (triggers re-index lazily).
    await ctx.db.prepare("DELETE FROM appointments").run();
    await ctx.db.prepare("DELETE FROM clinical_notes").run();
    await ctx.db.prepare("DELETE FROM patients").run();

    const imp = await app.request(
      "/api/backup/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(original),
      },
      { DB: ctx.db },
    );
    expect(imp.status).toBe(200);

    // The search-index backfill marker was cleared by the import, so the first
    // search must re-index and find the patient. FTS5 ranks by relevance with
    // arbitrary tie order (the name also appears in appointment bodies), so
    // assert on the patient hit rather than hits[0].
    const res = await app.request("/api/search?q=Tester", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { hits: { entity_type: string; title: string }[] };
    expect(data.hits.length).toBeGreaterThanOrEqual(1);
    const patientHit = data.hits.find((h) => h.entity_type === "patients");
    expect(patientHit).toBeDefined();
    expect(patientHit!.title).toContain("Tester");
  });
});
