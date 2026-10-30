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

const source = {
  name: "Post-extraction protocol",
  diagnosis: "Healing socket, tooth 46",
  on_examination: "Socket clean, no discharge",
  history: "Extraction 2 days ago",
  advice: "Soft diet for 48 hours; warm salt-water rinses.",
  items: [
    {
      drug_name: "Amoxicillin",
      dosage: "500 mg",
      frequency: "3x daily",
      duration: "5 days",
      instructions: "after meals",
    },
    { drug_name: "Ibuprofen", dosage: "400 mg", frequency: "as needed", duration: "3 days" },
  ],
};

async function saveTemplate(body: Record<string, unknown> = source) {
  const { path, init } = jsonRequest("POST", "/api/prescription-templates", body);
  const res = await app.request(path, init, { DB: ctx.db });
  return { res, data: (await res.json()) as { template?: Record<string, unknown>; error?: string } };
}

async function createPatient() {
  const { path, init } = jsonRequest("POST", "/api/patients", { first_name: "Grace", last_name: "Hopper" });
  const res = await app.request(path, init, { DB: ctx.db });
  expect(res.status).toBe(201);
  return ((await res.json()) as { patient: { id: number } }).patient.id;
}

/**
 * Saving a finished prescription as a reusable template: everything the
 * doctor wrote clinically comes back out of the API intact, so a later Rx can
 * be pre-filled from it.
 */
describe("POST /api/prescription-templates", () => {
  it("keeps the whole clinical content of the open prescription", async () => {
    const { res, data } = await saveTemplate();
    expect(res.status).toBe(201);
    expect(data.template).toMatchObject({
      name: "Post-extraction protocol",
      diagnosis: "Healing socket, tooth 46",
      on_examination: "Socket clean, no discharge",
      history: "Extraction 2 days ago",
      advice: "Soft diet for 48 hours; warm salt-water rinses.",
    });
    // Items are returned parsed, in print order.
    expect(data.template?.items).toEqual(source.items);
  });

  it("rejects a template with no name", async () => {
    const { res } = await saveTemplate({ ...source, name: "" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/prescription-templates", () => {
  it("lists saved templates newest first with JSON columns parsed", async () => {
    await saveTemplate();
    await saveTemplate({ ...source, name: "Second protocol" });

    const res = await app.request("/api/prescription-templates", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { templates } = (await res.json()) as { templates: { name: string; items: unknown[] }[] };

    const names = templates.map((t) => t.name);
    // The database also holds the sample templates, so assert the ordering of
    // the two just saved rather than the whole list.
    expect(names.indexOf("Second protocol")).toBeLessThan(names.indexOf("Post-extraction protocol"));
    expect(templates.find((t) => t.name === "Second protocol")?.items).toHaveLength(2);
  });
});

describe("a saved template pre-fills a new prescription", () => {
  it("carries medications, diagnosis, O/E and advice onto a fresh Rx", async () => {
    const { data } = await saveTemplate();
    const template = data.template as {
      diagnosis: string;
      on_examination: string;
      history: string;
      advice: string;
      items: { drug_name: string }[];
    };

    const patientId = await createPatient();
    const { path, init } = jsonRequest("POST", "/api/prescriptions", {
      patient_id: patientId,
      diagnosis: template.diagnosis,
      on_examination: template.on_examination,
      history: template.history,
      advice: template.advice,
      items: template.items,
    });
    const created = await app.request(path, init, { DB: ctx.db });
    expect(created.status).toBe(201);
    const rxId = ((await created.json()) as { prescription: { id: number } }).prescription.id;

    const read = await app.request(`/api/prescriptions/${rxId}`, undefined, { DB: ctx.db });
    const { prescription } = (await read.json()) as {
      prescription: { diagnosis: string; on_examination: string; advice: string; items: { drug_name: string }[] };
    };
    expect(prescription.diagnosis).toBe("Healing socket, tooth 46");
    expect(prescription.on_examination).toBe("Socket clean, no discharge");
    expect(prescription.advice).toBe("Soft diet for 48 hours; warm salt-water rinses.");
    expect(prescription.items.map((i) => i.drug_name)).toEqual(["Amoxicillin", "Ibuprofen"]);
  });
});

describe("DELETE /api/prescription-templates/:id", () => {
  it("removes the template and leaves issued prescriptions untouched", async () => {
    const { data } = await saveTemplate();
    const id = Number((data.template as { id: number }).id);

    const patientId = await createPatient();
    const rx = jsonRequest("POST", "/api/prescriptions", {
      patient_id: patientId,
      diagnosis: "Healing socket, tooth 46",
      items: [{ drug_name: "Amoxicillin" }],
    });
    const created = await app.request(rx.path, rx.init, { DB: ctx.db });
    const rxId = ((await created.json()) as { prescription: { id: number } }).prescription.id;

    const { path, init } = jsonRequest("DELETE", `/api/prescription-templates/${id}`);
    const del = await app.request(path, init, { DB: ctx.db });
    expect(del.status).toBe(200);

    const list = await app.request("/api/prescription-templates", undefined, { DB: ctx.db });
    const remaining = ((await list.json()) as { templates: { id: number }[] }).templates;
    expect(remaining.map((t) => t.id)).not.toContain(id);

    const read = await app.request(`/api/prescriptions/${rxId}`, undefined, { DB: ctx.db });
    expect(read.status).toBe(200);
    expect(((await read.json()) as { prescription: { diagnosis: string } }).prescription.diagnosis).toBe(
      "Healing socket, tooth 46",
    );
  });
});
