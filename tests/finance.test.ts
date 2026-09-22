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
  const { path, init } = jsonRequest("POST", "/api/patients", { first_name: "Ada", last_name: "Finance" });
  const res = await app.request(path, init, { DB: ctx.db });
  const { patient } = (await res.json()) as { patient: { id: number } };
  return patient.id;
}

async function makeInvoice(pid: number, total: number, paid = 0): Promise<number> {
  const { path, init } = jsonRequest("POST", "/api/invoices", { patient_id: pid, total, amount_paid: paid });
  const res = await app.request(path, init, { DB: ctx.db });
  const { invoice } = (await res.json()) as { invoice: { id: number } };
  return invoice.id;
}

describe("finance overview", () => {
  it("returns zeros on an empty practice", async () => {
    const res = await app.request("/api/finance/overview", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      stats: { total_appointments: number; total_revenue: number; remaining_balance: number };
      rows: unknown[];
    };
    expect(body.stats).toEqual({ total_appointments: 0, total_revenue: 0, remaining_balance: 0 });
    expect(body.rows).toEqual([]);
  });

  it("aggregates revenue and remaining balance, excluding void invoices", async () => {
    const pid = await patientId();
    await makeInvoice(pid, 200, 50); // open
    await makeInvoice(pid, 100, 100); // paid
    await makeInvoice(pid, 999, 0);
    // Void the third invoice.
    {
      const { path, init } = jsonRequest("PUT", `/api/invoices/${3}`, { status: "void" });
      await app.request(path, init, { DB: ctx.db });
    }
    const res = await app.request("/api/finance/overview", undefined, { DB: ctx.db });
    const body = (await res.json()) as {
      stats: { total_appointments: number; total_revenue: number; remaining_balance: number };
      rows: { balance: number }[];
    };
    expect(body.stats.total_revenue).toBe(300);
    expect(body.stats.remaining_balance).toBe(150);
    expect(body.rows).toHaveLength(2);
  });

  it("date filters apply to both stats and rows", async () => {
    const pid = await patientId();
    const inv = await makeInvoice(pid, 80, 0);
    // Backdate the invoice two years so a from-date excludes it.
    await app.request(
      `/api/invoices/${inv}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ total: 80 }) },
      { DB: ctx.db },
    );
    // issued_at can't be set through the API; verify the filter only via the
    // query contract — a future 'from' yields no rows.
    const res = await app.request("/api/finance/overview?from=2999-01-01&to=2999-12-31", undefined, { DB: ctx.db });
    const body = (await res.json()) as {
      stats: { total_revenue: number };
      rows: unknown[];
    };
    expect(body.stats.total_revenue).toBe(0);
    expect(body.rows).toEqual([]);
  });

  it("carries patient, service and doctor info on rows", async () => {
    const pid = await patientId();
    const inv = await makeInvoice(pid, 120, 40);
    const { path, init } = jsonRequest("PUT", `/api/invoices/${inv}/items`, {
      items: [{ description: "Composite filling", quantity: 1, unit_price: 120 }],
    });
    await app.request(path, init, { DB: ctx.db });
    const res = await app.request("/api/finance/overview", undefined, { DB: ctx.db });
    const body = (await res.json()) as {
      rows: { patient_name: string; service: string; total: number; balance: number }[];
    };
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].patient_name).toBe("Ada Finance");
    expect(body.rows[0].service).toBe("Composite filling");
    expect(body.rows[0].total).toBe(120);
    expect(body.rows[0].balance).toBe(80);
  });
});
