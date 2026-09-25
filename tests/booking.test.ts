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

interface BookingLinkRow {
  link: { id: number; token: string; label: string; days_ahead: number; active: number };
}

/**
 * The next bookable date, UTC-based like the server: slot generation works on
 * UTC calendar dates and Sundays are closed (getUTCDay() === 0), so a naive
 * "local tomorrow" could land on a Sunday (e.g. running late Saturday night
 * in a timezone behind UTC) and see an empty slot list. Skip to Monday.
 */
function nextOpenDateIso(): string {
  const d = new Date(Date.now() + 86_400_000);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function createLink(overrides: Record<string, unknown> = {}): Promise<BookingLinkRow["link"]> {
  const req = jsonRequest("POST", "/api/booking/links", { label: "Test booking", ...overrides });
  const res = await app.request(req.path, req.init, { DB: ctx.db });
  expect(res.status).toBe(201);
  const j = (await res.json()) as BookingLinkRow;
  return j.link;
}

describe("online booking", () => {
  it("creates a link with a unique 36-char token", async () => {
    const link = await createLink();
    expect(link.token).toMatch(/^[a-f0-9]{36}$/);
    expect(link.active).toBe(1);
    const link2 = await createLink();
    expect(link2.token).not.toBe(link.token);
  });

  it("public info endpoint exposes only clinic identity + treatments", async () => {
    const link = await createLink({ label: "Facebook page" });
    const res = await app.request(`/api/public/booking/${link.token}`, undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      label: string; clinic_name: string; treatments: unknown[]; days_ahead: number;
    };
    expect(j.label).toBe("Facebook page");
    expect(j.days_ahead).toBe(14);
    expect(Array.isArray(j.treatments)).toBe(true);
    // No patient data may leak through the public payload.
    const raw = JSON.stringify(j);
    expect(raw).not.toContain("first_name");
    expect(raw).not.toContain("phone");
  });

  it("rejects unknown or inactive tokens", async () => {
    const bad = await app.request("/api/public/booking/deadbeefdeadbeefdeadbeefdeadbeefdead", undefined, { DB: ctx.db });
    expect(bad.status).toBe(404);
    const link = await createLink();
    const req = jsonRequest("PUT", `/api/booking/links/${link.id}`, { active: false });
    await app.request(req.path, req.init, { DB: ctx.db });
    const res = await app.request(`/api/public/booking/${link.token}`, undefined, { DB: ctx.db });
    expect(res.status).toBe(404);
  });

  it("returns free slots inside opening hours and marks booked ones", async () => {
    const link = await createLink();
    const date = nextOpenDateIso();
    const res = await app.request(`/api/public/booking/${link.token}/slots?date=${date}`, undefined, { DB: ctx.db });
    expect(res.status).toBe(200);
    const { slots } = (await res.json()) as { slots: { time: string }[] };
    expect(slots.length).toBeGreaterThan(0);
    // First slot at day start (07:00 default) — booked slots are excluded.
    expect(slots[0].time).toBe(`${date}T07:00:00`);
  });

  it("books a real appointment end-to-end and registers the patient", async () => {
    const link = await createLink();
    const date = nextOpenDateIso();
    const slotsRes = await app.request(`/api/public/booking/${link.token}/slots?date=${date}`, undefined, { DB: ctx.db });
    const { slots } = (await slotsRes.json()) as { slots: { time: string }[] };
    const slot = slots[0];

    const req = jsonRequest("POST", `/api/public/booking/${link.token}`, {
      first_name: "Nadia",
      last_name: "Islam",
      phone: "+8801711000000",
      start_time: slot.time,
      notes: "booked from the website",
    });
    const res = await app.request(req.path, req.init, { DB: ctx.db });
    expect(res.status).toBe(201);

    // The appointment exists on the agenda with the patient attached.
    const patients = await app.request("/api/patients", undefined, { DB: ctx.db });
    const { patients: list } = (await patients.json()) as { patients: { id: number; first_name: string; phone: string | null }[] };
    const nadia = list.find((p) => p.first_name === "Nadia");
    expect(nadia).toBeTruthy();
    expect(nadia!.phone).toBe("+8801711000000");

    const appts = await app.request(`/api/appointments?date=${date}`, undefined, { DB: ctx.db });
    const { appointments } = (await appts.json()) as { appointments: { start_time: string; patient_id: number | null; status: string }[] };
    const booked = appointments.find((a) => a.start_time === slot.time);
    expect(booked).toBeTruthy();
    expect(booked!.patient_id).toBe(nadia!.id);
    expect(booked!.status).toBe("scheduled");

    // The same slot is no longer offered.
    const slotsRes2 = await app.request(`/api/public/booking/${link.token}/slots?date=${date}`, undefined, { DB: ctx.db });
    const { slots: slots2 } = (await slotsRes2.json()) as { slots: { time: string }[] };
    expect(slots2.find((s) => s.time === slot.time)).toBeUndefined();

    // Audit row recorded.
    const feed = await app.request("/api/booking/requests", undefined, { DB: ctx.db });
    const { requests } = (await feed.json()) as { requests: { first_name: string; start_time: string }[] };
    expect(requests.some((r) => r.first_name === "Nadia" && r.start_time === slot.time)).toBe(true);
  });

  it("rejects a double-booking of the same slot with 409", async () => {
    const link = await createLink();
    const date = nextOpenDateIso();
    const slotsRes = await app.request(`/api/public/booking/${link.token}/slots?date=${date}`, undefined, { DB: ctx.db });
    const { slots } = (await slotsRes.json()) as { slots: { time: string }[] };
    const slot = slots[0];
    const body = { first_name: "A", last_name: "B", start_time: slot.time };
    const first = jsonRequest("POST", `/api/public/booking/${link.token}`, body);
    expect((await app.request(first.path, first.init, { DB: ctx.db })).status).toBe(201);
    const second = jsonRequest("POST", `/api/public/booking/${link.token}`, { ...body, first_name: "C" });
    const res = await app.request(second.path, second.init, { DB: ctx.db });
    expect(res.status).toBe(409);
  });

  it("rejects bookings outside opening hours", async () => {
    const link = await createLink();
    const date = nextOpenDateIso();
    const req = jsonRequest("POST", `/api/public/booking/${link.token}`, {
      first_name: "Late",
      last_name: "Night",
      start_time: `${date}T23:30:00`,
    });
    const res = await app.request(req.path, req.init, { DB: ctx.db });
    expect(res.status).toBe(400);
  });

  it("validates input on link creation", async () => {
    const req = jsonRequest("POST", "/api/booking/links", { days_ahead: 500 });
    const res = await app.request(req.path, req.init, { DB: ctx.db });
    expect(res.status).toBe(400);
  });
});
