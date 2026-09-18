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
  // First request triggers the seed lifecycle.
  await app.request("/api/health", undefined, { DB: ctx.db });
});

async function seedPatient(overrides: Record<string, unknown> = {}) {
  const { path, init } = jsonRequest("POST", "/api/patients", {
    first_name: "Grace",
    last_name: "Hopper",
    date_of_birth: "1990-05-10",
    medical_alerts: "allergy:penicillin",
    ...overrides,
  });
  const res = await app.request(path, init, { DB: ctx.db });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { patient: { id: number } };
  return data.patient.id;
}

function rxBody(patientId: number, overrides: Record<string, unknown> = {}) {
  return {
    patient_id: patientId,
    template: "classic",
    diagnosis: "Acute periapical abscess, tooth 36",
    advice: "Rinse with warm salt water.",
    follow_up: "Recheck in 2 weeks",
    items: [
      { drug_name: "Amoxicillin", dosage: "500 mg", frequency: "3x daily", duration: "5 days", instructions: "after meals" },
      { drug_name: "Ibuprofen", dosage: "400 mg", frequency: "as needed", duration: "3 days", instructions: null },
    ],
    ...overrides,
  };
}

describe("prescriptions CRUD", () => {
  it("creates with items and orders them", async () => {
    const pid = await seedPatient();
    const { path, init } = jsonRequest("POST", "/api/prescriptions", rxBody(pid));
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(201);
    const { prescription } = (await res.json()) as {
      prescription: { id: number; items: { drug_name: string }[]; issued_date: string };
    };
    expect(prescription.items).toHaveLength(2);
    expect(prescription.items[0].drug_name).toBe("Amoxicillin");
    // issued_date defaults to today.
    expect(prescription.issued_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("accepts every supported template and rejects unknown ones", async () => {
    const pid = await seedPatient();
    for (const template of ["classic", "modern", "compact", "elegant", "minimal", "bold", "watermark"]) {
      const { path, init } = jsonRequest("POST", "/api/prescriptions", rxBody(pid, { template }));
      const res = await app.request(path, init, { DB: ctx.db });
      expect(res.status, `template ${template} should be accepted`).toBe(201);
      const { prescription } = (await res.json()) as { prescription: { template: string } };
      expect(prescription.template).toBe(template);
    }

    const bad = jsonRequest("POST", "/api/prescriptions", rxBody(pid, { template: "neon" }));
    const badRes = await app.request(bad.path, bad.init, { DB: ctx.db });
    expect(badRes.status).toBe(400);
  });

  it("rejects a prescription with no medication rows", async () => {
    const pid = await seedPatient();
    const { path, init } = jsonRequest("POST", "/api/prescriptions", rxBody(pid, { items: [] }));
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(400);
  });

  it("rejects an item without a drug name", async () => {
    const pid = await seedPatient();
    const { path, init } = jsonRequest("POST", "/api/prescriptions", rxBody(pid, { items: [{ dosage: "500 mg" }] }));
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(400);
  });

  it("replaces items on update", async () => {
    const pid = await seedPatient();
    const created = await app.request(
      "/api/prescriptions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rxBody(pid)) },
      { DB: ctx.db },
    );
    const { prescription } = (await created.json()) as { prescription: { id: number } };

    const { path, init } = jsonRequest("PUT", `/api/prescriptions/${prescription.id}`, {
      items: [{ drug_name: "Metronidazole", dosage: "400 mg", frequency: "3x daily", duration: "5 days", instructions: null }],
    });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { prescription: updated } = (await res.json()) as { prescription: { items: { drug_name: string }[] } };
    expect(updated.items).toHaveLength(1);
    expect(updated.items[0].drug_name).toBe("Metronidazole");
  });

  it("lists a patient's prescriptions newest first with counts", async () => {
    const pid = await seedPatient();
    for (const date of ["2026-01-01", "2026-03-01"]) {
      const { path, init } = jsonRequest("POST", "/api/prescriptions", rxBody(pid, { issued_date: date }));
      await app.request(path, init, { DB: ctx.db });
    }
    const res = await app.request(`/api/patients/${pid}/prescriptions`, undefined, { DB: ctx.db });
    const data = (await res.json()) as { prescriptions: { issued_date: string; item_count: number }[] };
    expect(data.prescriptions).toHaveLength(2);
    expect(data.prescriptions[0].issued_date).toBe("2026-03-01");
    expect(data.prescriptions[0].item_count).toBe(2);
  });

  it("deletes", async () => {
    const pid = await seedPatient();
    const created = await app.request(
      "/api/prescriptions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rxBody(pid)) },
      { DB: ctx.db },
    );
    const { prescription } = (await created.json()) as { prescription: { id: number } };
    const del = await app.request(`/api/prescriptions/${prescription.id}`, { method: "DELETE" }, { DB: ctx.db });
    expect(del.status).toBe(200);
  });
});

describe("prescription sharing", () => {
  it("serves a public view by token with letterhead, and nothing else", async () => {
    const pid = await seedPatient();
    const profile = await app.request(
      "/api/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_name: "Sarah", doctor_license: "DDS-102938", clinic_name: "Bright Smile" }),
      },
      { DB: ctx.db },
    );
    expect(profile.status).toBe(200);

    const created = await app.request(
      "/api/prescriptions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rxBody(pid)) },
      { DB: ctx.db },
    );
    const { prescription } = (await created.json()) as { prescription: { id: number } };

    const share = await app.request(`/api/prescriptions/${prescription.id}/share`, { method: "POST" }, { DB: ctx.db });
    expect(share.status).toBe(200);
    const { share_token } = (await share.json()) as { share_token: string };
    expect(share_token).toMatch(/^[a-f0-9]{32}$/);

    const pub = await app.request(`/api/public/prescriptions/${share_token}`, undefined, { DB: ctx.db });
    expect(pub.status).toBe(200);
    const data = (await pub.json()) as {
      prescription: {
        patient_first_name: string;
        practice: { doctor_name: string; doctor_license: string };
        items: unknown[];
        patient_medical_alerts?: string;
      };
    };
    expect(data.prescription.patient_first_name).toBe("Grace");
    expect(data.prescription.practice.doctor_name).toBe("Sarah");
    expect(data.prescription.practice.doctor_license).toBe("DDS-102938");
    expect(data.prescription.items).toHaveLength(2);
    // Public payload must not leak contact info or alerts beyond the sheet.
    expect(data.prescription.patient_medical_alerts).toBeUndefined();
  });

  it("revoking kills the public link", async () => {
    const pid = await seedPatient();
    const created = await app.request(
      "/api/prescriptions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rxBody(pid)) },
      { DB: ctx.db },
    );
    const { prescription } = (await created.json()) as { prescription: { id: number } };
    const { share_token } = (await (
      await app.request(`/api/prescriptions/${prescription.id}/share`, { method: "POST" }, { DB: ctx.db })
    ).json()) as { share_token: string };

    const rev = await app.request(`/api/prescriptions/${prescription.id}/share`, { method: "DELETE" }, { DB: ctx.db });
    expect(rev.status).toBe(200);
    const pub = await app.request(`/api/public/prescriptions/${share_token}`, undefined, { DB: ctx.db });
    expect(pub.status).toBe(404);
  });

  it("unknown tokens 404", async () => {
    const res = await app.request(`/api/public/prescriptions/${"a".repeat(32)}`, undefined, { DB: ctx.db });
    expect(res.status).toBe(404);
  });
});

describe("prescriptions in backups", () => {
  it("survive an export → wipe → import round-trip", async () => {
    const pid = await seedPatient();
    const created = await app.request(
      "/api/prescriptions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rxBody(pid)) },
      { DB: ctx.db },
    );
    const { prescription } = (await created.json()) as { prescription: { id: number; items: unknown[] } };

    const exported = await app.request("/api/backup/export", undefined, { DB: ctx.db });
    const backup = (await exported.json()) as { tables: Record<string, { id: number }[]> };
    expect(backup.tables.prescriptions).toHaveLength(1);
    expect(backup.tables.prescription_items).toHaveLength(2);

    // Wipe and re-import.
    await ctx.db.prepare("DELETE FROM prescriptions").run();
    const imp = await app.request(
      "/api/backup/import",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(backup),
      },
      { DB: ctx.db },
    );
    expect(imp.status).toBe(200);

    const again = await app.request(`/api/prescriptions/${prescription.id}`, undefined, { DB: ctx.db });
    expect(again.status).toBe(200);
    const data = (await again.json()) as { prescription: { id: number; items: unknown[] } };
    expect(data.prescription.id).toBe(prescription.id);
    expect(data.prescription.items).toHaveLength(2);
  });
});
