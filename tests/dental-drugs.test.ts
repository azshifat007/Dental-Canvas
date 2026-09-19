import { describe, expect, it } from "vitest";
import { DENTAL_DRUGS, searchDentalDrugs } from "../src/client/lib/dental-drugs";

describe("dental drug presets", () => {
  it("covers the main prescribing groups used in dentistry", () => {
    const groups = new Set(DENTAL_DRUGS.map((d) => d.group));
    expect(groups).toContain("Antibiotic");
    expect(groups).toContain("Analgesic");
    expect(groups).toContain("Antifungal");
    expect(groups).toContain("Antiviral");
    expect(groups).toContain("Antiseptic rinse");
  });

  it("every preset has a complete dosing regimen", () => {
    for (const d of DENTAL_DRUGS) {
      expect(d.name.trim().length, d.name).toBeGreaterThan(0);
      expect(d.dosage.trim().length, d.name).toBeGreaterThan(0);
      expect(d.frequency.trim().length, d.name).toBeGreaterThan(0);
      expect(d.duration.trim().length, d.name).toBeGreaterThan(0);
    }
  });

  it("matches drugs by prefix and substring of the name", () => {
    const byPrefix = searchDentalDrugs("amox");
    expect(byPrefix[0]?.name).toBe("Amoxicillin");

    const bySubstring = searchDentalDrugs("chlorhex");
    expect(bySubstring.some((d) => d.name.includes("Chlorhexidine"))).toBe(true);
  });

  it("matches brand names and aliases", () => {
    const flagyl = searchDentalDrugs("flagyl");
    expect(flagyl[0]?.name).toBe("Metronidazole");

    const tylenol = searchDentalDrugs("tylenol");
    expect(tylenol.some((d) => d.name.startsWith("Paracetamol"))).toBe(true);
  });

  it("is case-insensitive and returns nothing for empty queries", () => {
    expect(searchDentalDrugs("IBUPROFEN").length).toBeGreaterThan(0);
    expect(searchDentalDrugs("")).toEqual([]);
    expect(searchDentalDrugs("   ")).toEqual([]);
  });

  it("respects the result limit", () => {
    expect(searchDentalDrugs("a", 3).length).toBeLessThanOrEqual(3);
  });
});
