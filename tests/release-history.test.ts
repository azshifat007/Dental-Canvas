import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCacheFresh,
  isCurrentVersion,
  loadReleaseHistory,
  parseReleases,
  readCachedHistory,
  __clearReleaseHistoryCacheForTests,
  type ReleaseHistory,
} from "../src/client/lib/release-history";

// The lib talks to browser globals (window.localStorage, __APP_VERSION__ from
// the Vite build). Stub them with minimal in-memory equivalents.
function makeLocalStorageShim(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
}

const sampleApiPayload = [
  {
    tag_name: "v1.4.19",
    name: "v1.4.19 — bulletproof scrolling",
    body: "Medicine list scroll fix\nAlways-visible scrollbar",
    published_at: "2026-10-01T12:00:00Z",
    draft: false,
    prerelease: false,
  },
  {
    tag_name: "v1.4.18",
    name: "",
    body: "Android offline boot fallback",
    published_at: "2026-09-20T09:00:00Z",
  },
  { name: "broken — no tag", body: "must be dropped" },
  "not even an object",
];

beforeEach(() => {
  vi.stubGlobal("window", { localStorage: makeLocalStorageShim() });
  vi.stubGlobal("__APP_VERSION__", "1.4.19");
});

afterEach(() => {
  __clearReleaseHistoryCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("parseReleases", () => {
  it("maps API entries to the slim shape and drops unusable ones", () => {
    const entries = parseReleases(sampleApiPayload);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      tag: "v1.4.19",
      name: "v1.4.19 — bulletproof scrolling",
      notes: "Medicine list scroll fix\nAlways-visible scrollbar",
      publishedAt: "2026-10-01T12:00:00Z",
    });
    // Empty release title falls back to the tag.
    expect(entries[1].name).toBe("v1.4.18");
  });

  it("returns [] for non-array payloads and missing notes", () => {
    expect(parseReleases(null)).toEqual([]);
    expect(parseReleases({ message: "Not Found" })).toEqual([]);
    const entries = parseReleases([{ tag_name: "v1.0.0" }]);
    expect(entries).toEqual([{ tag: "v1.0.0", name: "v1.0.0", notes: "", publishedAt: "" }]);
  });
});

describe("isCurrentVersion", () => {
  it("matches with or without the leading v", () => {
    expect(isCurrentVersion("v1.4.19")).toBe(true);
    expect(isCurrentVersion("1.4.19")).toBe(true);
    expect(isCurrentVersion("v1.4.18")).toBe(false);
  });
});

describe("readCachedHistory", () => {
  it("round-trips a written cache", () => {
    const history: ReleaseHistory = {
      releases: [{ tag: "v1.4.19", name: "v1.4.19", notes: "x", publishedAt: "2026-10-01" }],
      fetchedAt: Date.now(),
    };
    window.localStorage.setItem("dental-canvas:release-history", JSON.stringify(history));
    expect(readCachedHistory()).toEqual(history);
  });

  it("returns null for missing, malformed, or empty caches", () => {
    expect(readCachedHistory()).toBeNull();
    window.localStorage.setItem("dental-canvas:release-history", "{not json");
    expect(readCachedHistory()).toBeNull();
    window.localStorage.setItem("dental-canvas:release-history", JSON.stringify({ releases: [] }));
    expect(readCachedHistory()).toBeNull();
  });
});

describe("isCacheFresh", () => {
  it("is fresh within the TTL and stale beyond it", () => {
    const now = Date.now();
    expect(isCacheFresh({ releases: [], fetchedAt: now - 3600_000 })).toBe(true);
    expect(isCacheFresh({ releases: [], fetchedAt: now - 25 * 3600_000 })).toBe(false);
    expect(isCacheFresh({ releases: [], fetchedAt: 0 })).toBe(false);
  });
});

describe("loadReleaseHistory", () => {
  it("short-circuits on a fresh cache without hitting the network", async () => {
    const history: ReleaseHistory = {
      releases: [{ tag: "v1.4.19", name: "v1.4.19", notes: "x", publishedAt: "2026-10-01" }],
      fetchedAt: Date.now(),
    };
    window.localStorage.setItem("dental-canvas:release-history", JSON.stringify(history));
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const { history: result, fromCache } = await loadReleaseHistory();
    expect(fromCache).toBe(true);
    expect(result).toEqual(history);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to a stale cache when the network fails (offline)", async () => {
    const stale: ReleaseHistory = {
      releases: [{ tag: "v1.4.18", name: "v1.4.18", notes: "x", publishedAt: "2026-09-20" }],
      fetchedAt: Date.now() - 25 * 3600_000,
    };
    window.localStorage.setItem("dental-canvas:release-history", JSON.stringify(stale));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const { history, fromCache } = await loadReleaseHistory();
    expect(fromCache).toBe(true);
    expect(history).toEqual(stale);
  });

  it("refreshes a stale cache from the API and re-caches", async () => {
    const stale: ReleaseHistory = {
      releases: [{ tag: "v1.4.18", name: "v1.4.18", notes: "old", publishedAt: "2026-09-20" }],
      fetchedAt: Date.now() - 25 * 3600_000,
    };
    window.localStorage.setItem("dental-canvas:release-history", JSON.stringify(stale));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => sampleApiPayload }));

    const { history, fromCache } = await loadReleaseHistory();
    expect(fromCache).toBe(false);
    expect(history!.releases.map((r) => r.tag)).toEqual(["v1.4.19", "v1.4.18"]);
    // The fresh copy is now in localStorage for offline sessions.
    expect(readCachedHistory()!.releases[0].tag).toBe("v1.4.19");
  });

  it("returns null (not an error) with no cache and no network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const { history, fromCache } = await loadReleaseHistory();
    expect(history).toBeNull();
    expect(fromCache).toBe(false);
  });
});
