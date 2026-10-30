import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
vi.mock("@/api", () => ({ api: apiMock }));

/**
 * The client side of "Save as template": what gets sent, what the shared list
 * looks like afterwards, and the name/summary shown on the one-click button.
 */

async function store() {
  return import("@/lib/rx-clinical-templates");
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Post-extraction protocol",
    diagnosis: "Healing socket",
    on_examination: null,
    history: null,
    advice: null,
    items: [{ drug_name: "Amoxicillin" }],
    created_at: "2026-10-30 10:00:00",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  apiMock.mockReset();
});

describe("saving an open prescription as a template", () => {
  it("posts the clinical content, trimmed, with blank medication rows dropped", async () => {
    apiMock.mockResolvedValueOnce({ template: template() });
    const { saveRxClinicalTemplate } = await store();

    await saveRxClinicalTemplate("  Post-extraction protocol  ", {
      diagnosis: "  Healing socket  ",
      on_examination: "",
      history: " Extraction 2 days ago ",
      advice: " Soft diet ",
      items: [
        { drug_name: " Amoxicillin ", dosage: " 500 mg ", frequency: null, duration: "", instructions: null },
        { drug_name: "   " }, // an untouched row is not content
      ],
    });

    expect(apiMock).toHaveBeenCalledTimes(1);
    const [method, path, body] = apiMock.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(method).toBe("POST");
    expect(path).toBe("/api/prescription-templates");
    expect(body).toEqual({
      name: "Post-extraction protocol",
      diagnosis: "Healing socket",
      on_examination: null,
      history: "Extraction 2 days ago",
      advice: "Soft diet",
      items: [
        {
          drug_name: "Amoxicillin",
          dosage: "500 mg",
          frequency: null,
          schedule: null,
          meal_relation: null,
          duration: null,
          instructions: null,
        },
      ],
    });
  });

  it("shows the saved template in the shared list immediately (no refetch)", async () => {
    apiMock.mockResolvedValueOnce({ template: template({ id: 9, name: "Fresh" }) });
    const { saveRxClinicalTemplate, loadRxClinicalTemplates } = await store();

    await saveRxClinicalTemplate("Fresh", { items: [{ drug_name: "Ibuprofen" }] });

    // Only the POST was made — loading reads the cache the save just updated.
    const list = await loadRxClinicalTemplates();
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(list.map((t) => t.name)).toEqual(["Fresh"]);
  });
});

describe("the template list", () => {
  it("loads once and shares one cache across callers", async () => {
    apiMock.mockResolvedValue({ templates: [template({ id: 1 })] });
    const { loadRxClinicalTemplates } = await store();

    const [a, b] = await Promise.all([loadRxClinicalTemplates(), loadRxClinicalTemplates()]);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  it("degrades to an empty list when the request fails", async () => {
    apiMock.mockRejectedValueOnce(new Error("offline"));
    const { loadRxClinicalTemplates } = await store();
    expect(await loadRxClinicalTemplates()).toEqual([]);
  });

  it("drops a deleted template from the shared list", async () => {
    apiMock.mockResolvedValueOnce({ templates: [template({ id: 1 }), template({ id: 2, name: "Other" })] });
    const { loadRxClinicalTemplates, deleteRxClinicalTemplate } = await store();
    await loadRxClinicalTemplates();

    apiMock.mockResolvedValueOnce({ ok: true });
    await deleteRxClinicalTemplate(1);

    const [method, path] = apiMock.mock.calls[1] as [string, string];
    expect(method).toBe("DELETE");
    expect(path).toBe("/api/prescription-templates/1");

    const list = await loadRxClinicalTemplates();
    expect(list.map((t) => t.id)).toEqual([2]);
  });
});

describe("naming the template from the Rx", () => {
  it("uses the diagnosis when there is one", async () => {
    const { suggestedTemplateName } = await store();
    expect(
      suggestedTemplateName({ diagnosis: "periapical abscess, tooth 36", items: [{ drug_name: "Amoxicillin" }] }),
    ).toBe("Periapical abscess, tooth 36");
  });

  it("shortens a long diagnosis instead of overflowing the field", async () => {
    const { suggestedTemplateName } = await store();
    const name = suggestedTemplateName({
      diagnosis: "Chronic generalised periodontitis with generalised attachment loss and mobility",
      items: [],
    });
    expect(name.length).toBeLessThanOrEqual(52);
    expect(name.endsWith("…")).toBe(true);
  });

  it("falls back to the medications, then to a default", async () => {
    const { suggestedTemplateName } = await store();
    expect(
      suggestedTemplateName({ diagnosis: "", items: [{ drug_name: "Amoxicillin" }, { drug_name: "Ibuprofen" }] }),
    ).toBe("Amoxicillin + Ibuprofen protocol");
    expect(suggestedTemplateName({ items: [] })).toBe("My prescription template");
  });

  it("summarises what a menu entry carries", async () => {
    const { templateSummary } = await store();
    expect(templateSummary({ items: [{ drug_name: "A" }] })).toBe("1 medication");
    expect(templateSummary({ items: [{ drug_name: "A" }, { drug_name: "B" }], advice: "Soft diet" })).toBe(
      "2 medications · advice",
    );
  });
});
