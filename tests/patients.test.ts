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

/** POST /api/patients returning the created row. */
async function createPatient(body: Record<string, unknown>) {
  const { path, init } = jsonRequest("POST", "/api/patients", body);
  const res = await app.request(path, init, { DB: ctx.db });
  return res;
}

async function getPatient(id: number) {
  const res = await app.request(`/api/patients/${id}`, undefined, { DB: ctx.db });
  expect(res.status).toBe(200);
  return (await res.json()) as { patient: Record<string, unknown> };
}

describe("quick patient registration", () => {
  it("registers a patient with only a name", async () => {
    const res = await createPatient({ first_name: "Jenny", last_name: "Wilson" });
    expect(res.status).toBe(201);
    const { patient } = (await res.json()) as { patient: { id: number; email: string | null } };
    expect(patient.id).toBeGreaterThan(0);
    expect(patient.email).toBeNull();
  });

  it("registers with name + phone only (typical quick add)", async () => {
    const res = await createPatient({ first_name: "Guy", last_name: "Hawkins", phone: "555-0100" });
    expect(res.status).toBe(201);
    const { patient } = (await res.json()) as { patient: { phone: string } };
    expect(patient.phone).toBe("555-0100");
  });

  it("rejects a patient without a name", async () => {
    const res = await createPatient({ phone: "555-0100" });
    expect(res.status).toBe(400);
  });
});

describe("edit after registration", () => {
  it("fills in details later via partial update", async () => {
    const created = await createPatient({ first_name: "Jane", last_name: "Cooper" });
    const { patient } = (await created.json()) as { patient: { id: number } };

    const { path, init } = jsonRequest("PUT", `/api/patients/${patient.id}`, {
      date_of_birth: "1988-03-22",
      phone: "555-0142",
      medical_alerts: "allergy:penicillin",
    });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { patient: updated } = (await res.json()) as {
      patient: { date_of_birth: string; phone: string; medical_alerts: string; first_name: string };
    };
    expect(updated.date_of_birth).toBe("1988-03-22");
    expect(updated.phone).toBe("555-0142");
    expect(updated.medical_alerts).toBe("allergy:penicillin");
    // Untouched fields survive a partial update.
    expect(updated.first_name).toBe("Jane");
  });

  it("round-trips a quick registration through the full edit payload", async () => {
    const created = await createPatient({ first_name: "Leslie", last_name: "Alexander" });
    const { patient } = (await created.json()) as { patient: { id: number } };

    // This is the exact body the client sends when saving from the edit dialog
    // (every field present, blanks normalized to null).
    const { path, init } = jsonRequest("PUT", `/api/patients/${patient.id}`, {
      first_name: "Leslie",
      last_name: "Alexander",
      date_of_birth: null,
      email: "leslie@example.com",
      phone: null,
      address: null,
      medical_alerts: null,
      referral_source: "Walk-in",
      notes: null,
    });
    const res = await app.request(path, init, { DB: ctx.db });
    expect(res.status).toBe(200);
    const after = await getPatient(patient.id);
    expect(after.patient.email).toBe("leslie@example.com");
    expect(after.patient.referral_source).toBe("Walk-in");
  });
});

describe("duplicate detection search", () => {
  it("finds an existing patient by phone digits for the duplicate warning", async () => {
    await createPatient({ first_name: "Existing", last_name: "Person", phone: "(555) 010-0111" });
    const res = await app.request("/api/patients?q=5550100111", undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { patients: { last_name: string }[] };
    expect(data.patients).toHaveLength(1);
    expect(data.patients[0].last_name).toBe("Person");
  });

  it("finds patients by partial last name", async () => {
    await createPatient({ first_name: "Jane", last_name: "Cooper" });
    const res = await app.request("/api/patients?q=coop", undefined, { DB: ctx.db });
    const data = (await res.json()) as { patients: { last_name: string }[] };
    expect(data.patients).toHaveLength(1);
  });
});
