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
    for (const template of ["chamber", "classic", "modern", "compact", "elegant", "minimal", "bold", "watermark"]) {
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

  it("stores and updates the large-print flag", async () => {
    const pid = await seedPatient();

    // Defaults to off.
    const created = await app.request(
      "/api/prescriptions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rxBody(pid)) },
      { DB: ctx.db },
    );
    const { prescription } = (await created.json()) as { prescription: { id: number; large_print: number } };
    expect(prescription.large_print).toBe(0);

    // Create with large print on.
    const big = jsonRequest("POST", "/api/prescriptions", rxBody(pid, { large_print: true }));
    const bigRes = await app.request(big.path, big.init, { DB: ctx.db });
    expect(bigRes.status).toBe(201);
    const { prescription: bigRx } = (await bigRes.json()) as { prescription: { large_print: number } };
    expect(bigRx.large_print).toBe(1);

    // Flip it off via PUT.
    const upd = jsonRequest("PUT", `/api/prescriptions/${prescription.id}`, { large_print: true });
    const updRes = await app.request(upd.path, upd.init, { DB: ctx.db });
    expect(updRes.status).toBe(200);
    const { prescription: flipped } = (await updRes.json()) as { prescription: { large_print: number } };
    expect(flipped.large_print).toBe(1);

    // And it appears in the patient list rows too.
    const list = await app.request(`/api/patients/${pid}/prescriptions`, undefined, { DB: ctx.db });
    const data = (await list.json()) as { prescriptions: { large_print: number }[] };
    expect(data.prescriptions.some((p) => p.large_print === 1)).toBe(true);
  });

  it("links a tooth and a treatment-plan procedure and joins the name through", async () => {
    const pid = await seedPatient();

    // A plan item with a treatment type, so the join has something to resolve.
    const types = await app.request("/api/treatment-types", undefined, { DB: ctx.db });
    const { treatment_types: ttList } = (await types.json()) as { treatment_types: { id: number }[] };
    const planRes = await app.request(
      "/api/treatment-plan-items",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: pid, treatment_type_id: ttList[0].id, tooth: "36", fee: 120 }),
      },
      { DB: ctx.db },
    );
    expect(planRes.status).toBe(201);
    const { item: planItem } = (await planRes.json()) as { item: { id: number; treatment_name: string } };

    const { path, init } = jsonRequest("POST", "/api/prescriptions", rxBody(pid, { tooth: "36", plan_item_id: planItem.id }));
    const created = await app.request(path, init, { DB: ctx.db });
    expect(created.status).toBe(201);
    const { prescription } = (await created.json()) as {
      prescription: { id: number; tooth: string | null; plan_item_id: number | null; plan_treatment_name: string | null };
    };
    expect(prescription.tooth).toBe("36");
    expect(prescription.plan_item_id).toBe(planItem.id);
    // The joined procedure name resolves through the plan item.
    expect(prescription.plan_treatment_name).toBe(planItem.treatment_name);

    // Detail GET carries the same joined data.
    const detail = await app.request(`/api/prescriptions/${prescription.id}`, undefined, { DB: ctx.db });
    const { prescription: full } = (await detail.json()) as { prescription: { plan_treatment_name: string | null } };
    expect(full.plan_treatment_name).toBe(planItem.treatment_name);

    // Tooth is editable independently of the plan link.
    const upd = jsonRequest("PUT", `/api/prescriptions/${prescription.id}`, { tooth: "37" });
    const updRes = await app.request(upd.path, upd.init, { DB: ctx.db });
    expect(updRes.status).toBe(200);
    const { prescription: moved } = (await updRes.json()) as { prescription: { tooth: string | null; plan_item_id: number | null } };
    expect(moved.tooth).toBe("37");
    expect(moved.plan_item_id).toBe(planItem.id);

    // Deleting the plan item keeps the prescription (SET NULL) but drops the link.
    const del = await app.request(`/api/treatment-plan-items/${planItem.id}`, { method: "DELETE" }, { DB: ctx.db });
    expect(del.status).toBe(200);
    const after = await app.request(`/api/prescriptions/${prescription.id}`, undefined, { DB: ctx.db });
    const { prescription: orphaned } = (await after.json()) as {
      prescription: { tooth: string | null; plan_item_id: number | null; plan_treatment_name: string | null };
    };
    expect(orphaned.tooth).toBe("37");
    expect(orphaned.plan_item_id).toBeNull();
    expect(orphaned.plan_treatment_name).toBeNull();
  });

  it("carries tooth and joined plan name on the detail payload", async () => {
    const pid = await seedPatient();
    const planRes = await app.request(
      "/api/treatment-plan-items",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: pid, tooth: "14", fee: 0 }),
      },
      { DB: ctx.db },
    );
    const { item: planItem } = (await planRes.json()) as { item: { id: number } };
    const { path, init } = jsonRequest("POST", "/api/prescriptions", rxBody(pid, { tooth: "14", plan_item_id: planItem.id }));
    await app.request(path, init, { DB: ctx.db });
    const list = await app.request(`/api/patients/${pid}/prescriptions`, undefined, { DB: ctx.db });
    const { prescriptions } = (await list.json()) as { prescriptions: { id: number; tooth: string | null; plan_treatment_name: string | null }[] };
    expect(prescriptions[0].tooth).toBe("14");
    // The plan item had no treatment type — name is null but tooth still flows.
    expect(prescriptions[0].plan_treatment_name).toBeNull();
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

describe("prescription settings", () => {
  it("rejects a clinic logo that is not an image data URL", async () => {
    const res = await app.request(
      "/api/settings",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinic_logo: "<script>alert(1)</script>" }),
      },
      { DB: ctx.db },
    );
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: string };
    expect(error).toMatch(/logo/i);
  });
});

describe("prescription share endpoints", () => {
  // Sharing is now a PDF *file* through the platform share sheet (client-side),
  // so the token-link system was removed: no public endpoint, no share routes,
  // and the schema no longer needs token columns. These tests pin the removal.
  it("public token endpoint is gone", async () => {
    const res = await app.request(`/api/public/prescriptions/${"a".repeat(32)}`, undefined, { DB: ctx.db });
    expect(res.status).toBe(404);
  });

  it("share create/rotate routes are gone", async () => {
    const pid = await seedPatient();
    const created = await app.request(
      "/api/prescriptions",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rxBody(pid)) },
      { DB: ctx.db },
    );
    const { prescription } = (await created.json()) as { prescription: { id: number } };
    const post = await app.request(`/api/prescriptions/${prescription.id}/share`, { method: "POST" }, { DB: ctx.db });
    expect(post.status).toBe(404);
    const del = await app.request(`/api/prescriptions/${prescription.id}/share`, { method: "DELETE" }, { DB: ctx.db });
    expect(del.status).toBe(404);
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
