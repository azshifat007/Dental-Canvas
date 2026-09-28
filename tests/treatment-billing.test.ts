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
  await app.request("/api/health", undefined, { DB: ctx.db });
});

async function patientId(): Promise<number> {
  const { path, init } = jsonRequest("POST", "/api/patients", { first_name: "Riaz", last_name: "Khan" });
  const res = await app.request(path, init, { DB: ctx.db });
  const { patient } = (await res.json()) as { patient: { id: number } };
  return patient.id;
}

async function createPlanItem(pid: number, body: Record<string, unknown> = {}): Promise<{ id: number; fee: number; tooth: string | null }> {
  const { path, init } = jsonRequest("POST", "/api/treatment-plan-items", { patient_id: pid, ...body });
  const res = await app.request(path, init, { DB: ctx.db });
  expect(res.status).toBe(201);
  const { item } = (await res.json()) as { item: { id: number; fee: number; tooth: string | null } };
  return item;
}

describe("treatment plan → billing sync", () => {
  it("adds a plan item to a new invoice and links it", async () => {
    const pid = await patientId();
    const item = await createPlanItem(pid, { fee: 4000, tooth: "36" });

    const res = await app.request(`/api/treatment-plan-items/${item.id}/invoice`, { method: "POST" }, { DB: ctx.db });
    expect(res.status).toBe(201);
    const { invoice } = (await res.json()) as { invoice: { id: number; total: number; status: string } };
    expect(invoice.status).toBe("open");
    expect(invoice.total).toBe(4000);

    const detail = await app.request(`/api/invoices/${invoice.id}`, undefined, { DB: ctx.db });
    const { items } = (await detail.json()) as { items: { description: string; unit_price: number; treatment_plan_item_id: number | null }[] };
    expect(items).toHaveLength(1);
    expect(items[0].unit_price).toBe(4000);
    expect(items[0].treatment_plan_item_id).toBe(item.id);
    expect(items[0].description).toContain("36");
  });

  it("reuses the patient's open invoice instead of creating duplicates", async () => {
    const pid = await patientId();
    const first = await createPlanItem(pid, { fee: 500 });
    const second = await createPlanItem(pid, { fee: 700 });

    await app.request(`/api/treatment-plan-items/${first.id}/invoice`, { method: "POST" }, { DB: ctx.db });
    const res = await app.request(`/api/treatment-plan-items/${second.id}/invoice`, { method: "POST" }, { DB: ctx.db });
    const { invoice } = (await res.json()) as { invoice: { id: number; total: number } };
    expect(invoice.total).toBe(1200);
  });

  it("is idempotent — billing the same plan item twice does not duplicate the line", async () => {
    const pid = await patientId();
    const item = await createPlanItem(pid, { fee: 900 });

    await app.request(`/api/treatment-plan-items/${item.id}/invoice`, { method: "POST" }, { DB: ctx.db });
    const res = await app.request(`/api/treatment-plan-items/${item.id}/invoice`, { method: "POST" }, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { invoice } = (await res.json()) as { invoice: { id: number; total: number } };
    expect(invoice.total).toBe(900);

    const detail = await app.request(`/api/invoices/${invoice.id}`, undefined, { DB: ctx.db });
    const { items } = (await detail.json()) as { items: unknown[] };
    expect(items).toHaveLength(1);
  });

  it("returns 404 for an unknown plan item", async () => {
    const res = await app.request("/api/treatment-plan-items/99999/invoice", { method: "POST" }, { DB: ctx.db });
    expect(res.status).toBe(404);
  });
});

describe("prescription clinical fields (O/E, H/O)", () => {
  it("stores and returns on_examination and history", async () => {
    const pid = await patientId();
    const { path, init } = jsonRequest("POST", "/api/prescriptions", {
      patient_id: pid,
      items: [{ drug_name: "Amoxicillin 500mg" }],
      diagnosis: "Acute pulpitis 36",
      on_examination: "Tenderness on percussion, deep caries",
      history: "Pain for 3 days, worse at night",
    });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(201);
    const { prescription } = (await res.json()) as { prescription: { id: number; diagnosis: string | null; on_examination: string | null; history: string | null } };
    expect(prescription.diagnosis).toBe("Acute pulpitis 36");
    expect(prescription.on_examination).toBe("Tenderness on percussion, deep caries");
    expect(prescription.history).toBe("Pain for 3 days, worse at night");

    const upd = await app.request(
      `/api/prescriptions/${prescription.id}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ history: "Updated history" }) },
      { DB: ctx.db },
    );
    expect(upd.status).toBe(200);
    const { prescription: updated } = (await upd.json()) as { prescription: { history: string | null; on_examination: string | null } };
    expect(updated.history).toBe("Updated history");
    expect(updated.on_examination).toBe("Tenderness on percussion, deep caries");
  });
});

describe("currency setting", () => {
  it("defaults to USD and persists BDT", async () => {
    const initial = await app.request("/api/settings", undefined, { DB: ctx.db });
    const before = (await initial.json()) as { settings: Record<string, string> };
    expect(before.settings.currency).toBe("USD");

    const { path, init } = jsonRequest("PUT", "/api/settings", { currency: "BDT" });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { settings } = (await res.json()) as { settings: Record<string, string> };
    expect(settings.currency).toBe("BDT");
  });
});
