import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, freshApp, jsonRequest, type TestContext } from "./helpers";
import { buildMatchExpression } from "../src/server/search";

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
  app = await freshApp(); // fresh seed/backfill singletons per test
});

async function seedPatient(overrides: Record<string, unknown> = {}) {
  const { path, init } = jsonRequest("POST", "/api/patients", {
    first_name: "Jamie",
    last_name: "Rivera",
    email: "jamie@example.test",
    phone: "555-0142",
    notes: "Prefers morning appointments",
    ...overrides,
  });
  const res = await app.request(path, init, { DB: ctx.db });
  expect(res.status).toBe(201);
  const data = (await res.json()) as { patient: { id: number } };
  return data.patient.id;
}

describe("match expression builder", () => {
  it("quotes tokens and applies prefix matching", () => {
    expect(buildMatchExpression("rivera smith")).toBe(`"rivera"* "smith"*`);
  });

  it("neutralizes FTS5 query syntax", () => {
    const expr = buildMatchExpression("' OR '");
    // Every token must be a fully quoted term — a quoted "OR" is a literal
    // search term, not the boolean operator, so injection is impossible.
    for (const term of expr.split(" ")) {
      expect(term).toMatch(/^"[^"]*"\*$/);
    }
  });

  it("caps the number of terms", () => {
    const expr = buildMatchExpression("a b c d e f g h i j k");
    expect(expr.split(" ")).toHaveLength(8);
  });

  it("escapes embedded double quotes", () => {
    expect(buildMatchExpression('tooth"14')).toBe(`"tooth""14"*`);
  });
});

describe("GET /api/search", () => {
  it("returns empty hits for a blank query", async () => {
    const res = await app.request("/api/search?q=", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hits: [], via: "fts5" });
  });

  it("finds a patient by last name via the trigger-synced index", async () => {
    await seedPatient();
    const res = await app.request("/api/search?q=Rivera", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { via: string; hits: { entity_type: string; title: string }[] };
    expect(data.via).toBe("fts5");
    expect(data.hits).toHaveLength(1);
    expect(data.hits[0]).toMatchObject({ entity_type: "patients", title: "Rivera, Jamie" });
    expect(data.hits[0]).toHaveProperty("patient_id");
    expect(data.hits[0]).toHaveProperty("snippet");
  });

  it("finds a patient by phone fragment", async () => {
    await seedPatient();
    const res = await app.request("/api/search?q=0142", undefined, { DB: ctx.db });
    const data = (await res.json()) as { hits: { entity_type: string }[] };
    expect(data.hits).toHaveLength(1);
    expect(data.hits[0].entity_type).toBe("patients");
  });

  it("does not duplicate rows when writes precede the first search (backfill idempotency)", async () => {
    // Triggers index the patient immediately; the lazy backfill must not
    // insert the same row a second time.
    await seedPatient();
    const res = await app.request("/api/search?q=Rivera", undefined, { DB: ctx.db });
    const data = (await res.json()) as { hits: unknown[] };
    expect(data.hits).toHaveLength(1);
  });

  it("reflects updates", async () => {
    const id = await seedPatient();
    const { path, init } = jsonRequest("PUT", `/api/patients/${id}`, { last_name: "Rivera-Smith" });
    await app.request(path, init, { DB: ctx.db });

    // unicode61 tokenizes on the hyphen, so both prefixes match — but the
    // indexed title must be the UPDATED one (a stale index would still show
    // the old title).
    const neu = await app.request("/api/search?q=Rivera-Smith", undefined, { DB: ctx.db });
    const neuData = (await neu.json()) as { hits: { title: string }[] };
    expect(neuData.hits.map((h) => h.title)).toContain("Rivera-Smith, Jamie");

    const old = await app.request("/api/search?q=Rivera", undefined, { DB: ctx.db });
    const oldData = (await old.json()) as { hits: { title: string }[] };
    expect(oldData.hits).toHaveLength(1);
    expect(oldData.hits[0].title).toBe("Rivera-Smith, Jamie");
  });

  it("removes deleted records from the index", async () => {
    const id = await seedPatient();
    const del = jsonRequest("DELETE", `/api/patients/${id}`);
    const delRes = await app.request(del.path, del.init, { DB: ctx.db });
    expect(delRes.status).toBe(200);

    const res = await app.request("/api/search?q=Rivera", undefined, { DB: ctx.db });
    const data = (await res.json()) as { hits: unknown[] };
    expect(data.hits).toHaveLength(0);
  });

  it("indexes across multiple entity types", async () => {
    const pid = await seedPatient();
    const note = jsonRequest("POST", "/api/clinical-notes", {
      patient_id: pid,
      body: "Apical abscess on tooth 14, prescribed amoxicillin",
    });
    await app.request(note.path, note.init, { DB: ctx.db });

    const res = await app.request("/api/search?q=amoxicillin", undefined, { DB: ctx.db });
    const data = (await res.json()) as { hits: { entity_type: string; patient_id: number | null }[] };
    expect(data.hits).toHaveLength(1);
    expect(data.hits[0].entity_type).toBe("clinical_notes");
    expect(data.hits[0].patient_id).toBe(pid);
  });

  it("tolerates query syntax abuse without erroring", async () => {
    await seedPatient();
    const res = await app.request("/api/search?q=%27%20OR%20%27", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { hits: unknown[]; via: string };
    expect(data.via).toBe("fts5");
    expect(data.hits).toEqual([]);
  });

  it("primes the lazy backfill and restores an emptied index", async () => {
    // Simulate a pre-backfill database: the row exists in the source table
    // (indexed by its trigger), the backfill marker is unset because no search
    // has run yet. The first query must leave the data searchable.
    await seedPatient();
    const res = await app.request("/api/search?q=Rivera", undefined, { DB: ctx.db });
    const data = (await res.json()) as { via: string; hits: { title: string }[] };
    expect(data.via).toBe("fts5");
    expect(data.hits).toHaveLength(1);
  });

  it("respects the limit parameter", async () => {
    for (const name of ["Alpha", "Beta", "Gamma"]) {
      await seedPatient({ first_name: name, last_name: "Tester", email: null, phone: null, notes: null });
    }
    const res = await app.request("/api/search?q=Tester&limit=2", undefined, { DB: ctx.db });
    const data = (await res.json()) as { hits: unknown[] };
    expect(data.hits.length).toBeLessThanOrEqual(2);
  });
});

describe("POST /api/search/reindex", () => {
  it("rebuilds the index and repairs drift", async () => {
    const pid = await seedPatient();

    // Prime the lazy backfill first (as in production, where it has already
    // run) so the corruption below is not silently repaired by it.
    await app.request("/api/search?q=Rivera", undefined, { DB: ctx.db });

    // Corrupt: remove the patient's rows from the index.
    await ctx.db.prepare("DELETE FROM search_index WHERE entity_type = 'patients'").run();
    const before = await app.request("/api/search?q=Rivera", undefined, { DB: ctx.db });
    expect(((await before.json()) as { hits: unknown[] }).hits).toHaveLength(0);

    const re = await app.request("/api/search/reindex", { method: "POST" }, { DB: ctx.db });
    expect(re.status).toBe(200);
    const reData = (await re.json()) as { ok: boolean; counts: Record<string, number> };
    expect(reData.ok).toBe(true);
    expect(reData.counts.patients).toBe(1);

    const after = await app.request("/api/search?q=Rivera", undefined, { DB: ctx.db });
    const afterData = (await after.json()) as { hits: { entity_type: string; patient_id: number | null }[] };
    expect(afterData.hits).toHaveLength(1);
    expect(afterData.hits[0].patient_id).toBe(pid);
  });

  it("is idempotent across repeated rebuilds", async () => {
    await seedPatient();
    for (let i = 0; i < 2; i++) {
      const re = await app.request("/api/search/reindex", { method: "POST" }, { DB: ctx.db });
      expect(re.status).toBe(200);
    }
    const res = await app.request("/api/search?q=Rivera", undefined, { DB: ctx.db });
    const data = (await res.json()) as { hits: unknown[] };
    expect(data.hits).toHaveLength(1);
  });
});
