import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PrescriptionSheet, type PrescriptionSheetData } from "@/components/prescriptions/prescription-sheet";
import { AppContext } from "@/context";
import { RxTemplatesTab } from "@/components/settings/rx-templates-tab";
import type { AppStateValue } from "@/hooks/use-app-state";
import type { RxTemplateConfig } from "@/types";

// The tab reads the practice's templates over the API when it mounts; the
// server-render check below only needs the gallery, so the fetch is stubbed.
vi.mock("@/api", () => ({ api: vi.fn(async () => ({ layouts: [] })) }));

/**
 * The printed sheet is the practice's own letterhead, so its content is
 * asserted structurally: every sidebar heading appears exactly once (the
 * chamber pad shipped a duplicated Complaints/Investigations/Vitals block),
 * and a practice-defined template prints only the blocks and details its
 * saved config asks for.
 */

function sheet(overrides: Partial<PrescriptionSheetData> = {}): PrescriptionSheetData {
  return {
    clinic_name: "Bright Smile Dental",
    clinic_address: "123 Main St",
    clinic_phone: "+1 555 010 2030",
    doctor_name: "Sarah",
    doctor_specialty: "Dentist",
    patient_name: "Grace Hopper",
    patient_id: 2,
    issued_date: "2026-09-19",
    template: "chamber",
    diagnosis: "Periapical abscess, tooth 36",
    on_examination: "Deep caries",
    history: "Pain for 5 days",
    advice: "Warm salt-water rinses.",
    follow_up: "Recheck in 2 weeks",
    items: [{ drug_name: "Ibuprofen", dosage: "400 mg" }],
    ...overrides,
  };
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function customConfig(overrides: Partial<RxTemplateConfig> = {}): RxTemplateConfig {
  return {
    layout: "sidebar",
    accent: "#123456",
    header_bg: "#ffffff",
    header_text: "#0f172a",
    font: "sans",
    show_rule: true,
    show_logo: false,
    show_bangla: false,
    show_watermark: false,
    show_signature: false,
    footer_note: "Call the clinic for emergencies",
    sections: [
      { key: "diagnosis", label: "", enabled: true },
      { key: "history", label: "History of complaint", enabled: true },
      { key: "investigations", label: "", enabled: false },
      { key: "vitals", label: "", enabled: true },
      { key: "xray", label: "", enabled: true },
    ],
    ...overrides,
  };
}

describe("Chamber (default) prescription sheet", () => {
  it("prints each clinical sidebar block exactly once", () => {
    const html = renderToStaticMarkup(createElement(PrescriptionSheet, { data: sheet() }));

    expect(count(html, "Complaints")).toBe(1);
    expect(count(html, "Investigations")).toBe(1);
    expect(count(html, "Vitals")).toBe(1);
    expect(count(html, "Treatment Plan")).toBe(1);
    expect(count(html, "X-ray")).toBe(1);
  });

  it("still prints the patient, the medications and the footer instructions once", () => {
    const html = renderToStaticMarkup(
      createElement(PrescriptionSheet, {
        data: sheet({ chamber_footer_instructions: "In case of bleeding, call us" }),
      }),
    );

    expect(count(html, "Grace Hopper")).toBe(1);
    expect(count(html, "Ibuprofen")).toBe(1);
    expect(count(html, "In case of bleeding, call us")).toBe(1);
  });
});

describe("Settings → Rx templates", () => {
  it("renders the built-in gallery and the new-template action", () => {
    const app = {
      profile: { clinic_name: "Bright Smile Dental", doctor_name: "Sarah", doctor_specialty: "Dentist" },
      setError: vi.fn(),
    } as unknown as AppStateValue;
    const html = renderToStaticMarkup(
      createElement(AppContext.Provider, { value: app }, createElement(RxTemplatesTab)),
    );

    expect(html).toContain("Prescription templates");
    expect(html).toContain("New template");
    // Every built-in can be customized into the doctor's own template.
    expect(html).toContain("Chamber");
    expect(html).toContain("Two-column");
    expect(html).toContain("No custom templates yet");
  });
});

describe("custom prescription template sheet", () => {
  it("renders the saved skin, including custom section headings", () => {
    const html = renderToStaticMarkup(
      createElement(PrescriptionSheet, {
        data: sheet({ template: "custom-7", template_config: customConfig() }),
      }),
    );

    // Accent drives the ℞ and the sidebar tint.
    expect(html).toContain("#123456");
    // A renamed block prints its heading, not the built-in label.
    expect(html).toContain("History of complaint");
    expect(html).not.toContain(">H/O");
    // Disabled blocks are left off entirely.
    expect(html).not.toContain("Investigations");
    // Turned-off details are gone.
    expect(html).not.toContain("Signature");
    // Config footer wins over the profile footer instructions.
    expect(html).toContain("Call the clinic for emergencies");
  });

  it("keeps the Bangla sub-labels only when asked for", () => {
    const without = renderToStaticMarkup(
      createElement(PrescriptionSheet, {
        data: sheet({ template: "custom-7", template_config: customConfig() }),
      }),
    );
    const withBn = renderToStaticMarkup(
      createElement(PrescriptionSheet, {
        data: sheet({ template: "custom-7", template_config: customConfig({ show_bangla: true }) }),
      }),
    );

    expect(without).not.toContain("পরীক্ষা");
    expect(withBn).toContain("রোগের বর্ণনা");
  });

  it("drops empty clinical rows on the stacked page but not on the sidebar pad", () => {
    const sparse = sheet({ diagnosis: null, history: null, on_examination: null, vitals: undefined });
    const stacked = renderToStaticMarkup(
      createElement(PrescriptionSheet, {
        data: { ...sparse, template: "custom-3", template_config: customConfig({ layout: "stacked" }) },
      }),
    );
    const sidebar = renderToStaticMarkup(
      createElement(PrescriptionSheet, {
        data: { ...sparse, template: "custom-3", template_config: customConfig() },
      }),
    );

    // Stacked prints a commercial sheet: no headings without content.
    expect(stacked).not.toContain("History of complaint");
    // The sidebar pad keeps its headings, so it doubles as a handwriting form.
    expect(sidebar).toContain("History of complaint");
  });
});
