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

interface ItemLite {
  id: number;
  name: string;
  category: string | null;
  sku: string | null;
  unit: string;
  current_stock: number;
  min_threshold: number;
  reorder_quantity: number | null;
  supplier_name: string | null;
  supplier_contact: string | null;
  batch_number: string | null;
  expiry_date: string | null;
  unit_cost: number;
  active: number;
}

async function createItem(over: Record<string, unknown> = {}): Promise<ItemLite> {
  const { path, init } = jsonRequest("POST", "/api/inventory", {
    name: "Test Gauze Rolls",
    category: "Consumables",
    sku: "CON-GAUZE",
    unit: "pack",
    current_stock: 8,
    min_threshold: 5,
    reorder_quantity: 20,
    supplier_name: "TestCo",
    supplier_contact: "sales@testco.example",
    batch_number: "TC-101",
    location: "Store room A",
    unit_cost: 7.5,
    ...over,
  });
  const res = await app.request(path, init, { DB: ctx.db });
  expect(res.status).toBe(201);
  const { item } = (await res.json()) as { item: ItemLite };
  return item;
}

async function scan(): Promise<{ open: number; by_kind: Record<string, number> }> {
  const res = await app.request("/api/inventory/scan", { method: "POST" }, { DB: ctx.db });
  expect(res.status).toBe(200);
  return (await res.json()) as { open: number; by_kind: Record<string, number> };
}

describe("inventory", () => {
  it("seeds starter dental-supply stock with relative expiry dates", async () => {
    const res = await app.request("/api/inventory", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { items } = (await res.json()) as { items: ItemLite[] };
    expect(items.length).toBeGreaterThanOrEqual(8);
    const gloves = items.find((i) => i.name.startsWith("Nitrile Exam Gloves"));
    expect(gloves).toBeTruthy();
    // Deliberately below threshold → should surface in the scan.
    expect(gloves!.current_stock).toBeLessThanOrEqual(gloves!.min_threshold);
    // Expiry dates were computed relative to today, not stored verbatim.
    const dam = items.find((i) => i.name.startsWith("Rubber Dam"));
    expect(dam).toBeTruthy();
    expect(dam!.expiry_date).toBeTruthy();
    expect(dam!.expiry_date!.length).toBe(10);
  });

  it("creates, lists and updates an inventory item", async () => {
    const item = await createItem();
    expect(item.current_stock).toBe(8);
    expect(item.unit).toBe("pack");

    const put = await app.request(
      `/api/inventory/${item.id}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ min_threshold: 10, supplier_name: "New Supplier" }) },
      { DB: ctx.db },
    );
    expect(put.status).toBe(200);
    const { item: updated } = (await put.json()) as { item: ItemLite };
    expect(updated.min_threshold).toBe(10);
    expect(updated.supplier_name).toBe("New Supplier");

    const list = await app.request("/api/inventory", undefined, { DB: ctx.db });
    const { items } = (await list.json()) as { items: ItemLite[] };
    expect(items.some((i) => i.name === "Test Gauze Rolls")).toBe(true);
  });

  it("soft-deletes items so the movement history survives", async () => {
    const item = await createItem();
    const res = await app.request(`/api/inventory/${item.id}`, { method: "DELETE" }, { DB: ctx.db });
    expect(res.status).toBe(200);

    const list = await app.request("/api/inventory", undefined, { DB: ctx.db });
    const { items } = (await list.json()) as { items: ItemLite[] };
    expect(items.some((i) => i.id === item.id)).toBe(false);

    const row = await ctx.db.prepare("SELECT active FROM inventory_items WHERE id = ?").bind(item.id).first<{ active: number }>();
    expect(row?.active).toBe(0);
  });

  it("requires a name", async () => {
    const res = await app.request(
      "/api/inventory",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "" }) },
      { DB: ctx.db },
    );
    expect(res.status).toBe(400);
  });

  it("stock-in increases the balance and records a movement", async () => {
    const item = await createItem({ current_stock: 8 });
    const res = await app.request(
      `/api/inventory/${item.id}/stock-in`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: 12, unit_cost: 6.9, reference: "PO-1042" }) },
      { DB: ctx.db },
    );
    expect(res.status).toBe(201);
    const { item: updated } = (await res.json()) as { item: ItemLite };
    expect(updated.current_stock).toBe(20);
    // Restock refreshes the unit cost used for valuation.
    expect(updated.unit_cost).toBe(6.9);

    const mv = await app.request(`/api/inventory/${item.id}/movements`, undefined, { DB: ctx.db });
    const { movements } = (await mv.json()) as { movements: { type: string; quantity: number; balance_after: number; reference: string | null }[] };
    expect(movements).toHaveLength(1);
    expect(movements[0].type).toBe("in");
    expect(movements[0].balance_after).toBe(20);
    expect(movements[0].reference).toBe("PO-1042");
  });

  it("stock-out decreases the balance; oversell is guarded", async () => {
    const item = await createItem({ current_stock: 3, min_threshold: 2 });
    const bad = await app.request(
      `/api/inventory/${item.id}/stock-out`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: 5, reason: "used" }) },
      { DB: ctx.db },
    );
    expect(bad.status).toBe(400);

    const ok = await app.request(
      `/api/inventory/${item.id}/stock-out`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: 5, reason: "used", allow_negative: true }) },
      { DB: ctx.db },
    );
    expect(ok.status).toBe(201);
    const { item: updated } = (await ok.json()) as { item: ItemLite };
    expect(updated.current_stock).toBe(-2);
  });

  it("adjusts the count to an exact figure", async () => {
    const item = await createItem({ current_stock: 8 });
    const res = await app.request(
      `/api/inventory/${item.id}/adjust`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_stock: 5, reason: "cycle count" }) },
      { DB: ctx.db },
    );
    expect(res.status).toBe(201);
    const { item: updated } = (await res.json()) as { item: ItemLite };
    expect(updated.current_stock).toBe(5);
  });

  it("the scan mints alerts for the seeded stock state and heals them on restock", async () => {
    // The seeds include an out-of-stock composite, two low items and an
    // expiring rubber-dam pack — the scan should flag all four.
    const first = await scan();
    expect(first.open).toBe(4);
    expect(first.by_kind.out_of_stock).toBe(1);
    expect(first.by_kind.low_stock).toBe(2);
    expect(first.by_kind.expiring).toBe(1);
    expect(first.by_kind.expired).toBe(0);

    const alerts = await app.request("/api/inventory/alerts", undefined, { DB: ctx.db });
    const { alerts: rows } = (await alerts.json()) as { alerts: { id: number; item_id: number; kind: string; item_name: string | null }[] };
    expect(rows).toHaveLength(4);
    expect(rows.some((r) => r.item_name?.includes("Composite Resin"))).toBe(true);

    // Restock the gloves above threshold → the next scan must clear that alert.
    const gloves = rows.find((r) => r.item_name?.startsWith("Nitrile Exam Gloves"));
    expect(gloves).toBeTruthy();
    const stockIn = await app.request(
      `/api/inventory/${gloves!.item_id}/stock-in`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity: 30 }) },
      { DB: ctx.db },
    );
    expect(stockIn.status).toBe(201);

    const after = await scan();
    expect(after.open).toBe(3);
    expect(after.by_kind.low_stock).toBe(1);
  });

  it("acknowledging an alert keeps it resolved and out of the open list", async () => {
    const item = await createItem({ current_stock: 1, min_threshold: 5 });
    await scan();

    const alerts = await app.request("/api/inventory/alerts", undefined, { DB: ctx.db });
    const { alerts: rows } = (await alerts.json()) as { alerts: { id: number; item_id: number }[] };
    const mine = rows.filter((r) => r.item_id === item.id);
    expect(mine.length).toBeGreaterThanOrEqual(1);

    const res = await app.request(
      `/api/inventory/alerts/${mine[0].id}/resolve`,
      { method: "POST" },
      { DB: ctx.db },
    );
    expect(res.status).toBe(200);

    const after = await app.request("/api/inventory/alerts", undefined, { DB: ctx.db });
    const { alerts: remaining } = (await after.json()) as { alerts: { id: number }[] };
    expect(remaining.some((r) => r.id === mine[0].id)).toBe(false);

    // The resolved row stays as history (rebuilding the open set never deletes it).
    const all = await ctx.db
      .prepare("SELECT COUNT(*) AS n FROM inventory_alerts WHERE id = ? AND resolved = 1")
      .bind(mine[0].id)
      .first<{ n: number }>();
    expect(all?.n).toBe(1);
  });

  it("persists and applies the alert settings", async () => {
    const get = await app.request("/api/inventory/settings", undefined, { DB: ctx.db });
    const { settings } = (await get.json()) as { settings: { inventory_expiry_alert_days: string; inventory_alert_email: string } };
    expect(Number(settings.inventory_expiry_alert_days)).toBe(30);
    expect(settings.inventory_alert_email).toBe("");

    const put = await app.request(
      "/api/inventory/settings",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inventory_expiry_alert_days: 60, inventory_alert_email: "orders@clinic.example" }) },
      { DB: ctx.db },
    );
    expect(put.status).toBe(200);

    const again = await app.request("/api/inventory/settings", undefined, { DB: ctx.db });
    const { settings: s2 } = (await again.json()) as { settings: { inventory_expiry_alert_days: string; inventory_alert_email: string } };
    expect(Number(s2.inventory_expiry_alert_days)).toBe(60);
    expect(s2.inventory_alert_email).toBe("orders@clinic.example");

    // Also merged into the global settings surface.
    const all = await app.request("/api/settings", undefined, { DB: ctx.db });
    const { settings: global } = (await all.json()) as { settings: Record<string, string> };
    expect(global.inventory_expiry_alert_days).toBe("60");
  });

  it("is included in backup exports and search results", async () => {
    const backup = await app.request("/api/backup/export", undefined, { DB: ctx.db });
    const payload = (await backup.json()) as { tables: Record<string, unknown[]> };
    expect(Array.isArray(payload.tables.inventory_items)).toBe(true);
    expect(payload.tables.inventory_items.length).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(payload.tables.inventory_movements)).toBe(true);
    expect(Array.isArray(payload.tables.inventory_alerts)).toBe(true);

    // Inventory respects seeding + search index via the sync triggers.
    const search = await app.request("/api/search?q=composite", undefined, { DB: ctx.db });
    const { hits } = (await search.json()) as { hits: { entity_type: string; title: string }[] };
    expect(hits.some((h) => h.entity_type === "inventory_items" && /composite/i.test(h.title))).toBe(true);
  });
});