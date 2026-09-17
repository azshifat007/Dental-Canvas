import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, freshApp, type TestContext } from "./helpers";
import {
  DEFAULT_SETTINGS,
  SEED_OPERATORIES,
  SEED_PRACTITIONERS,
  SEED_TREATMENT_TYPES,
} from "../src/server/seed";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await createTestContext();
});

afterAll(async () => {
  await ctx.dispose();
});

beforeEach(async () => {
  await ctx.resetDb();
});

async function countTable(db: TestContext["db"], table: string): Promise<number> {
  const res = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return res?.n ?? 0;
}

describe("first-request seeding", () => {
  it("seeds settings, operatories, practitioners and treatment types on the first API call", async () => {
    const app = await freshApp();
    const res = await app.request("/api/health", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);

    expect(await countTable(ctx.db, "operatories")).toBe(SEED_OPERATORIES.length);
    expect(await countTable(ctx.db, "practitioners")).toBe(SEED_PRACTITIONERS.length);
    expect(await countTable(ctx.db, "treatment_types")).toBe(SEED_TREATMENT_TYPES.length);

    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const row = await ctx.db
        .prepare("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .first<{ value: string }>();
      expect(row?.value).toBe(DEFAULT_SETTINGS[key]);
    }
  });

  it("exposes seeded lookups through the API", async () => {
    const app = await freshApp();
    await app.request("/api/health", undefined, { DB: ctx.db });

    const ops = await app.request("/api/operatories", undefined, { DB: ctx.db });
    const opsData = (await ops.json()) as { operatories: unknown[] };
    expect(opsData.operatories).toHaveLength(SEED_OPERATORIES.length);

    const prs = await app.request("/api/practitioners", undefined, { DB: ctx.db });
    const prsData = (await prs.json()) as { practitioners: unknown[] };
    expect(prsData.practitioners).toHaveLength(SEED_PRACTITIONERS.length);

    const tts = await app.request("/api/treatment-types", undefined, { DB: ctx.db });
    const ttsData = (await tts.json()) as { treatment_types: unknown[] };
    expect(ttsData.treatment_types).toHaveLength(SEED_TREATMENT_TYPES.length);
  });

  it("seeds exactly once across multiple requests (no duplicates)", async () => {
    const app = await freshApp();
    for (let i = 0; i < 3; i++) {
      await app.request("/api/health", undefined, { DB: ctx.db });
    }
    expect(await countTable(ctx.db, "operatories")).toBe(SEED_OPERATORIES.length);
    expect(await countTable(ctx.db, "practitioners")).toBe(SEED_PRACTITIONERS.length);
    expect(await countTable(ctx.db, "treatment_types")).toBe(SEED_TREATMENT_TYPES.length);
  });

  it("seeds concurrently on parallel first requests without duplicates", async () => {
    const app = await freshApp();
    // The app shell fires several API calls in parallel on first load; the
    // shared seeding promise must collapse them into one pass.
    await Promise.all([
      app.request("/api/operatories", undefined, { DB: ctx.db }),
      app.request("/api/practitioners", undefined, { DB: ctx.db }),
      app.request("/api/treatment-types", undefined, { DB: ctx.db }),
      app.request("/api/settings", undefined, { DB: ctx.db }),
    ]);
    expect(await countTable(ctx.db, "operatories")).toBe(SEED_OPERATORIES.length);
    expect(await countTable(ctx.db, "practitioners")).toBe(SEED_PRACTITIONERS.length);
    expect(await countTable(ctx.db, "treatment_types")).toBe(SEED_TREATMENT_TYPES.length);
  });
});

describe("delete persistence (the seed contract)", () => {
  it("does not resurrect deleted operatories, practitioners or treatment types", async () => {
    const app = await freshApp();
    await app.request("/api/health", undefined, { DB: ctx.db });

    const ops = (await (await app.request("/api/operatories", undefined, { DB: ctx.db })).json()) as {
      operatories: { id: number }[];
    };
    const prs = (await (await app.request("/api/practitioners", undefined, { DB: ctx.db })).json()) as {
      practitioners: { id: number }[];
    };
    const tts = (await (await app.request("/api/treatment-types", undefined, { DB: ctx.db })).json()) as {
      treatment_types: { id: number }[];
    };

    const del = (path: string) => app.request(path, { method: "DELETE" }, { DB: ctx.db });
    await del(`/api/operatories/${ops.operatories[0].id}`);
    await del(`/api/practitioners/${prs.practitioners[0].id}`);
    await del(`/api/treatment-types/${tts.treatment_types[0].id}`);

    // Simulate a new isolate (redeploy): fresh module state, same database.
    const app2 = await freshApp();
    await app2.request("/api/health", undefined, { DB: ctx.db });

    expect(await countTable(ctx.db, "operatories")).toBe(SEED_OPERATORIES.length - 1);
    expect(await countTable(ctx.db, "practitioners")).toBe(SEED_PRACTITIONERS.length - 1);
    expect(await countTable(ctx.db, "treatment_types")).toBe(SEED_TREATMENT_TYPES.length - 1);
  });
});

describe("settings", () => {
  it("restores deleted settings keys to defaults on the next request", async () => {
    const app = await freshApp();
    await app.request("/api/health", undefined, { DB: ctx.db });

    await ctx.db.prepare("DELETE FROM settings WHERE key = 'day_start_minute'").run();
    const app2 = await freshApp();
    await app2.request("/api/health", undefined, { DB: ctx.db });

    const res = await app2.request("/api/settings", undefined, { DB: ctx.db });
    const data = (await res.json()) as { settings: Record<string, string> };
    expect(data.settings.day_start_minute).toBe(DEFAULT_SETTINGS.day_start_minute);
  });

  it("persists updated settings across a simulated redeploy", async () => {
    const app = await freshApp();
    await app.request("/api/health", undefined, { DB: ctx.db });

    const put = await app.request(
      "/api/settings",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slot_minutes: "20" }) },
      { DB: ctx.db },
    );
    expect(put.status).toBe(200);

    const app2 = await freshApp();
    await app2.request("/api/health", undefined, { DB: ctx.db });
    const res = await app2.request("/api/settings", undefined, { DB: ctx.db });
    const data = (await res.json()) as { settings: Record<string, string> };
    expect(data.settings.slot_minutes).toBe("20");
  });
});
