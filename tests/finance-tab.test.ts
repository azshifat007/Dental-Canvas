import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The Finance nav entry is one destination with three views, so it has to ask
 * where to go. These cover the remembered tab and the paths where storage is
 * missing or holding something stale.
 */

function stubStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  });
  return map;
}

async function lib() {
  return import("@/lib/finance-tab");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Finance nav entry", () => {
  it("opens Billing Record the first time", async () => {
    stubStorage();
    const { lastFinanceTabPath } = await lib();
    expect(lastFinanceTabPath()).toBe("/finance/billing-record");
  });

  it("returns to the tab that was open last", async () => {
    stubStorage();
    const { lastFinanceTabPath, rememberFinanceTab } = await lib();

    rememberFinanceTab("revenue");
    expect(lastFinanceTabPath()).toBe("/finance/revenue-breakdown");

    rememberFinanceTab("appointments");
    expect(lastFinanceTabPath()).toBe("/finance/appointment-overview");
  });

  it("ignores a stale value instead of navigating nowhere", async () => {
    stubStorage({ "dental-canvas:finance-tab": "reports" });
    const { lastFinanceTabPath } = await lib();
    expect(lastFinanceTabPath()).toBe("/finance/billing-record");
  });

  it("still works when storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
    });
    const { lastFinanceTabPath, rememberFinanceTab } = await lib();

    expect(() => rememberFinanceTab("revenue")).not.toThrow();
    expect(lastFinanceTabPath()).toBe("/finance/billing-record");
  });
});
