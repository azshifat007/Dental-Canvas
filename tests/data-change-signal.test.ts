import { describe, expect, it, vi, beforeEach } from "vitest";
import { notifyDataChanged, onDataChanged } from "../src/client/lib/data-change-signal";
import { api } from "../src/client/api";

// ── data-change-signal ──────────────────────────────────────────────

describe("data-change-signal", () => {
  it("delivers events to subscribed listeners", () => {
    const seen: string[] = [];
    const off = onDataChanged((e) => seen.push(e.reason));
    notifyDataChanged("appointment");
    expect(seen).toEqual(["appointment"]);
    off();
    notifyDataChanged("patient");
    expect(seen).toEqual(["appointment"]); // unsubscribed — no more events
  });

  it("supports multiple listeners and listener errors never propagate", () => {
    const good = vi.fn();
    const bad = vi.fn(() => {
      throw new Error("broken listener");
    });
    onDataChanged(bad);
    const off = onDataChanged(good);
    expect(() => notifyDataChanged("invoice")).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    off();
  });
});

// ── api() mutation → reason mapping ────────────────────────────────

// Minimal fetch mock: the api helper only needs ok/status/json.
function mockFetchJson(status: number, body: unknown = {}) {
  const fn = vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("api() data-change signals", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["POST", "/api/appointments", "appointment"],
    ["PUT", "/api/appointments/5", "appointment"],
    ["DELETE", "/api/waiting-list/9", "appointment"],
    ["POST", "/api/patients", "patient"],
    ["PUT", "/api/patients/7", "patient"],
    ["PUT", "/api/invoices/3/items", "invoice"],
    ["POST", "/api/invoices/3/payments", "invoice"],
    ["POST", "/api/prescriptions", "prescription"],
    ["POST", "/api/clinical-notes", "clinical_note"],
    ["PUT", "/api/treatment-plan-items/4", "clinical_note"],
    ["POST", "/api/medicines", "medicine"],
    ["POST", "/api/inventory", "inventory"],
    ["POST", "/api/patients/7/images", "image"],
  ] as const)("signals %s %s as the right reason", async (method, path, expected) => {
    mockFetchJson(200);
    const seen: string[] = [];
    const off = onDataChanged((e) => seen.push(e.reason));
    await api(method, path);
    expect(seen).toEqual([expected]);
    off();
  });

  it.each([
    ["GET", "/api/appointments"],
    ["GET", "/api/patients?q=x"],
    ["POST", "/api/backup/auto"], // backing up must not trigger a backup
    ["POST", "/api/backup/snapshots"],
    ["PUT", "/api/settings"],
    ["PUT", "/api/storage/config"],
    ["POST", "/api/backup/drive/test"],
  ] as const)("does NOT signal for %s %s", async (method, path) => {
    mockFetchJson(200);
    const seen: string[] = [];
    const off = onDataChanged((e) => seen.push(e.reason));
    await api(method, path);
    expect(seen).toEqual([]);
    off();
  });

  it("does not signal when the request fails", async () => {
    mockFetchJson(400, { error: "nope" });
    const seen: string[] = [];
    const off = onDataChanged((e) => seen.push(e.reason));
    await expect(api("POST", "/api/appointments", {})).rejects.toThrow("nope");
    expect(seen).toEqual([]);
    off();
  });

  it("strips query strings before matching", async () => {
    mockFetchJson(200);
    const seen: string[] = [];
    const off = onDataChanged((e) => seen.push(e.reason));
    await api("POST", "/api/patients/7/images/uploads?x=1");
    expect(seen).toEqual(["image"]);
    off();
  });
});
