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

describe("medicines", () => {
  it("seeds the built-in dental presets on first run", async () => {
    const res = await app.request("/api/medicines", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { medicines } = (await res.json()) as { medicines: { name: string; drug_group: string; dosage: string }[] };
    expect(medicines.length).toBeGreaterThanOrEqual(20);
    const amox = medicines.find((m) => m.name === "Amoxicillin");
    expect(amox).toBeTruthy();
    expect(amox!.drug_group).toBe("Antibiotic");
    expect(amox!.dosage).toBe("500 mg");
  });

  it("creates, lists and updates a custom medicine", async () => {
    const { path, init } = jsonRequest("POST", "/api/medicines", {
      name: "Practice special rinse",
      drug_group: "Antiseptic rinse",
      dosage: "10 ml",
      frequency: "2x daily",
      duration: "7 days",
      instructions: "do not swallow",
    });
    const created = await app.request(path, init, { DB: ctx.db });
    expect(created.status).toBe(201);
    const { medicine } = (await created.json()) as { medicine: { id: number; name: string } };

    const put = await app.request(
      `/api/medicines/${medicine.id}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dosage: "15 ml" }) },
      { DB: ctx.db },
    );
    expect(put.status).toBe(200);
    const { medicine: updated } = (await put.json()) as { medicine: { dosage: string } };
    expect(updated.dosage).toBe("15 ml");

    const list = await app.request("/api/medicines", undefined, { DB: ctx.db });
    const { medicines } = (await list.json()) as { medicines: { name: string }[] };
    expect(medicines.some((m) => m.name === "Practice special rinse")).toBe(true);
  });

  it("rejects duplicate names (case-insensitive)", async () => {
    const first = await app.request(
      "/api/medicines",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "My Gel" }) },
      { DB: ctx.db },
    );
    expect(first.status).toBe(201);
    const second = await app.request(
      "/api/medicines",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "my gel" }) },
      { DB: ctx.db },
    );
    expect(second.status).toBe(409);
    const { error } = (await second.json()) as { error: string };
    expect(error).toMatch(/already/i);
  });

  it("requires a name", async () => {
    const res = await app.request(
      "/api/medicines",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "" }) },
      { DB: ctx.db },
    );
    expect(res.status).toBe(400);
  });

  it("removes a medicine", async () => {
    const created = await app.request(
      "/api/medicines",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Temp drug" }) },
      { DB: ctx.db },
    );
    const { medicine } = (await created.json()) as { medicine: { id: number } };
    const del = await app.request(`/api/medicines/${medicine.id}`, { method: "DELETE" }, { DB: ctx.db });
    expect(del.status).toBe(200);
    const list = await app.request("/api/medicines", undefined, { DB: ctx.db });
    const { medicines } = (await list.json()) as { medicines: { name: string }[] };
    expect(medicines.some((m) => m.name === "Temp drug")).toBe(false);
  });

  it("is included in backup exports", async () => {
    const res = await app.request("/api/backup/export", undefined, { DB: ctx.db });
    const backup = (await res.json()) as { tables: Record<string, unknown[]> };
    expect(Array.isArray(backup.tables.medicines)).toBe(true);
    expect(backup.tables.medicines.length).toBeGreaterThanOrEqual(20);
  });
});
