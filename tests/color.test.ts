import { describe, expect, it } from "vitest";
import { brandAccentFromHex, hexToOklch } from "../src/client/lib/color";

describe("hexToOklch", () => {
  it("converts known reference colors (Björn Ottosson's OKLab table)", () => {
    // Reference values from https://bottosson.github.io/posts/oklab/ — sRGB
    // white is L=1, and the red/green/blue primaries match to ~2 decimal
    // places.
    const white = hexToOklch("#ffffff");
    expect(white!.l).toBeCloseTo(1.0, 2);
    expect(white!.c).toBeCloseTo(0, 2);

    const red = hexToOklch("#ff0000");
    expect(red!.l).toBeCloseTo(0.628, 2);
    expect(red!.h).toBeCloseTo(29.23, 1);

    const green = hexToOklch("#00ff00");
    expect(green!.l).toBeCloseTo(0.866, 2);
    expect(green!.h).toBeCloseTo(142.5, 1);

    const blue = hexToOklch("#0000ff");
    expect(blue!.l).toBeCloseTo(0.452, 2);
    expect(blue!.h).toBeCloseTo(264.05, 1);
  });

  it("accepts 3-digit hex with and without the hash", () => {
    expect(hexToOklch("#0e7490")).not.toBeNull();
    expect(hexToOklch("0e7490")).not.toBeNull();
    const short = hexToOklch("#0e9");
    const full = hexToOklch("#00ee99");
    expect(short!.h).toBeCloseTo(full!.h, 1);
    expect(short!.l).toBeCloseTo(full!.l, 2);
  });

  it("rejects invalid input", () => {
    expect(hexToOklch("")).toBeNull();
    expect(hexToOklch("hello")).toBeNull();
    expect(hexToOklch("#12345")).toBeNull();
    expect(hexToOklch("zzzzzz")).toBeNull();
  });
});

describe("brandAccentFromHex", () => {
  it("extracts the hue for the default teal", () => {
    const teal = brandAccentFromHex("#0e7490");
    expect(teal).not.toBeNull();
    // Teal sits around 200–230° in OKLCH hue space.
    expect(teal!.hue).toBeGreaterThan(195);
    expect(teal!.hue).toBeLessThan(235);
  });

  it("falls back to the teal hue for near-grays where hue is meaningless", () => {
    const gray = brandAccentFromHex("#808080");
    expect(gray!.hue).toBe(195);
  });

  it("clamps the chroma scale to a legible range", () => {
    const dull = brandAccentFromHex("#5a5f4c"); // muddy olive, low chroma
    expect(dull!.chromaScale).toBeGreaterThanOrEqual(0.35);

    const vivid = brandAccentFromHex("#ff00ff"); // magenta, very high chroma
    expect(vivid!.chromaScale).toBeLessThanOrEqual(1.35);
  });

  it("gives different hues for different brand families", () => {
    const set = new Set(
      ["#0e7490", "#059669", "#2563eb", "#db2777", "#ea580c"].map(
        (h) => brandAccentFromHex(h)!.hue,
      ),
    );
    // All five presets land on distinct hues (quantized to whole degrees and
    // separated by far more than 1°).
    expect(set.size).toBe(5);
  });

  it("rejects invalid hex", () => {
    expect(brandAccentFromHex("nope")).toBeNull();
    expect(brandAccentFromHex("")).toBeNull();
  });
});
