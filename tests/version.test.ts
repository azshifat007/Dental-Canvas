import { describe, expect, it } from "vitest";
import { compareVersions, isNewer, parseVersion } from "@/lib/version";

describe("parseVersion", () => {
  it("accepts a leading v and pads to three parts", () => {
    expect(parseVersion("v1.4.22")).toEqual({ numbers: [1, 4, 22], prerelease: [] });
    expect(parseVersion("1.4").numbers).toEqual([1, 4, 0]);
  });

  it("separates prerelease and build metadata", () => {
    expect(parseVersion("1.4.23-beta.1")).toEqual({ numbers: [1, 4, 23], prerelease: ["beta", "1"] });
    expect(parseVersion("1.4.23+build.7").prerelease).toEqual([]);
  });
});

describe("compareVersions", () => {
  it("orders numeric parts", () => {
    expect(compareVersions("1.4.22", "1.4.23")).toBe(-1);
    expect(compareVersions("1.5.0", "1.4.99")).toBe(1);
    expect(compareVersions("1.4.22", "v1.4.22")).toBe(0);
    // Numeric, not lexicographic: 1.4.100 > 1.4.99.
    expect(compareVersions("1.4.100", "1.4.99")).toBe(1);
  });

  it("sorts prereleases before their release", () => {
    expect(compareVersions("1.4.23-beta.1", "1.4.23")).toBe(-1);
    expect(compareVersions("1.4.23", "1.4.23-rc.1")).toBe(1);
    expect(compareVersions("1.4.23-beta.2", "1.4.23-beta.10")).toBe(-1);
    expect(compareVersions("1.4.23-1", "1.4.23-alpha")).toBe(-1);
  });
});

describe("isNewer", () => {
  it("only reports strictly newer versions", () => {
    expect(isNewer("1.4.23", "1.4.22")).toBe(true);
    expect(isNewer("1.4.22", "1.4.22")).toBe(false);
    expect(isNewer("1.4.21", "1.4.22")).toBe(false);
    expect(isNewer("v1.4.23", "1.4.22")).toBe(true);
  });
});
