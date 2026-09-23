import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createOfflineD1, type D1LikeDatabase } from "../src/server/offline/sqlite-adapter";

/**
 * End-to-end: the REAL Hono server (src/server/index.ts) answering requests
 * over the offline sql.js adapter — exactly how the desktop service worker
 * runs it. No Miniflare, no network.
 */

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCHEMA_SQL = readFileSync(path.join(root, "src/server/schema.sql"), "utf8");

let d1: D1LikeDatabase;
let app: { fetch: (req: Request, env?: unknown) => Promise<Response> };

beforeAll(async () => {
  d1 = await createOfflineD1({
    schemaSql: SCHEMA_SQL,
    persistence: { load: async () => undefined, save: async () => {} },
  });
  const mod = await import("../src/server/index");
  app = mod.default as never;
});

const call = (path: string, init?: RequestInit): Promise<Response> =>
  app.fetch(new Request(`http://offline${path}`, init), { DB: d1 });

const json = async <T>(r: Promise<Response>): Promise<T> => (await r).json() as T;

describe("server over the offline adapter (desktop e2e)", () => {
  it("answers health and seeds the first-run data", async () => {
    const health = await call("/api/health");
    expect(health.status).toBe(200);

    const { operatories } = await json<{ operatories: unknown[] }>(call("/api/operatories"));
    expect(operatories.length).toBeGreaterThanOrEqual(1);
  });

  it("registers a patient, books an appointment, and creates an invoice", async () => {
    const { patient } = await json<{ patient: { id: number } }>(
      call("/api/patients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ first_name: "Ada", last_name: "Desktop" }) }),
    );
    expect(patient.id).toBeGreaterThan(0);

    const { operatories } = await json<{ operatories: { id: number }[] }>(call("/api/operatories"));
    const appt = await call("/api/appointments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        patient_id: patient.id,
        operatory_id: operatories[0].id,
        start_time: `${new Date().toISOString().slice(0, 10)}T10:00:00`,
        end_time: `${new Date().toISOString().slice(0, 10)}T10:30:00`,
      }),
    });
    expect(appt.status).toBe(201);

    const inv = await call("/api/invoices", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patient_id: patient.id, items: [{ description: "Checkup", price: 50 }] }),
    });
    expect(inv.status).toBe(201);
  });

  it("issues a prescription and prints data survives", async () => {
    const { patients } = await json<{ patients: { id: number }[] }>(call("/api/patients"));
    const pid = patients[0].id;
    const rx = await call("/api/prescriptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        patient_id: pid,
        template: "chamber",
        items: [{ drug_name: "Amoxicillin", dosage: "500mg", frequency: "3x/day", duration: "5 days" }],
      }),
    });
    expect(rx.status).toBe(201);
  });

  it("round-trips an image blob byte-perfect through the db-storage path", async () => {
    const { patients } = await json<{ patients: { id: number }[] }>(call("/api/patients"));
    const pid = patients[0].id;

    const { uploads } = await json<{ uploads: { key: string; upload_url: string }[] }>(
      call(`/api/patients/${pid}/images/uploads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: [{ name: "x.png", type: "image/png", size: 8 }] }),
      }),
    );
    const payload = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    expect((await call(uploads[0].upload_url, { method: "PUT", headers: { "content-type": "image/png" }, body: payload })).status).toBe(201);

    const { images } = await json<{ images: { url: string }[] }>(
      call(`/api/patients/${pid}/images`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: [{ key: uploads[0].key, file_name: "x.png", mime_type: "image/png", kind: "xray", size_bytes: 8 }] }),
      }),
    );
    const got = await call(images[0].url);
    expect(got.status).toBe(200);
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(payload));
  });

  it("finds the patient through search (FTS path with LIKE fallback)", async () => {
    const { hits } = await json<{ hits: { title: string }[] }>(call("/api/search?q=Desktop"));
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("persists settings changes", async () => {
    await call("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ doctor_name: "Dr. Desktop" }) });
    const { settings } = await json<{ settings: Record<string, string> }>(call("/api/settings"));
    expect(settings.doctor_name).toBe("Dr. Desktop");
  });
});
