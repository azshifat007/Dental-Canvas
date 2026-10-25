import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampPercent, ringGeometry, MiniStatRing, ProgressRing } from "@/components/ui/progress-ring";
import { DAILY_VISIT_CAPACITY, visitMetrics } from "@/components/dashboard/visits-metrics";

describe("progress ring geometry", () => {
  it("clamps values that cannot be drawn", () => {
    expect(clampPercent(65)).toBe(65);
    expect(clampPercent(-12)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    // An empty practice divides by zero on its way to a percentage.
    expect(clampPercent(Number.NaN)).toBe(0);
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("draws a circle whose arc length matches the percentage", () => {
    const empty = ringGeometry(0);
    const full = ringGeometry(100);
    const partial = ringGeometry(65);
    // radius = 50 - strokeWidth / 2, inside the 100x100 viewBox
    expect(empty.radius).toBe(45);
    expect(empty.circumference).toBeCloseTo(2 * Math.PI * 45, 6);
    // 0% shows no arc (offset equals the whole circumference), 100% shows all.
    expect(empty.dashOffset).toBeCloseTo(empty.circumference, 6);
    expect(full.dashOffset).toBeCloseTo(0, 6);
    expect(partial.dashOffset).toBeCloseTo(empty.circumference * 0.35, 6);
  });

  it("keeps the stroke inside the viewBox for any thickness", () => {
    expect(ringGeometry(50, 4).radius).toBe(48);
    expect(ringGeometry(50, 40).radius).toBe(30);
    // Out-of-range thickness is clamped instead of producing a negative radius.
    expect(ringGeometry(50, 999).radius).toBe(30);
    expect(ringGeometry(50, 0).radius).toBe(49.5);
  });
});

describe("ProgressRing markup", () => {
  it("exposes the value to assistive technology exactly once", () => {
    const html = renderToStaticMarkup(
      createElement(ProgressRing, { value: 65, label: "Chair utilization" }),
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="65"');
    expect(html).toContain('aria-valuemin="0"');
    expect(html).toContain('aria-valuemax="100"');
    expect(html).toContain('aria-label="Chair utilization"');
    // The visible number is decoration; the role and label above carry the value.
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("dc-ring-arc");
  });

  it("starts empty so the arc has somewhere to sweep from", () => {
    // Before mount the offset covers the whole circle; the .dc-ring-arc
    // transition then carries it to the real value (see styles.css).
    const html = renderToStaticMarkup(createElement(ProgressRing, { value: 65, label: "Load" }));
    const offset = html.match(/stroke-dashoffset="([0-9.]+)"/)?.[1];
    const dasharray = html.match(/stroke-dasharray="([0-9.]+)"/)?.[1];
    expect(offset).toBeDefined();
    expect(dasharray).toBeDefined();
    expect(Number(offset)).toBeCloseTo(Number(dasharray), 3);
  });

  it("reports a clamped value when the data overshoots the scale", () => {
    const html = renderToStaticMarkup(createElement(ProgressRing, { value: 240, label: "Load" }));
    expect(html).toContain('aria-valuenow="100"');
    expect(html).not.toContain('aria-valuenow="240"');
  });

  it("renders the mini gauge with its icon, percentage and label", () => {
    const html = renderToStaticMarkup(
      createElement(MiniStatRing, {
        icon: createElement("span", null, "x"),
        value: 74,
        label: "New patients",
      }),
    );
    expect(html).toContain('aria-label="New patients: 74 percent"');
    expect(html).toContain("74");
    expect(html).toContain("New patients");
  });
});

describe("dashboard visit metrics", () => {
  it("returns zeros, not NaN, for a practice with no visits", () => {
    const m = visitMetrics(null);
    expect(m).toMatchObject({ visits: 0, fillPercent: 0, newShare: 0, returningShare: 0, openPercent: 100 });
    expect(m.visitsDelta).toBeNull();
    for (const value of Object.values(m)) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  it("measures today's visits against the day's chair slots", () => {
    const m = visitMetrics({ total_visits: 12, new_patients: 3, returning_patients: 9 });
    expect(m.capacity).toBe(DAILY_VISIT_CAPACITY);
    expect(m.fillPercent).toBe(60);
    expect(m.openSlots).toBe(8);
    expect(m.openPercent).toBe(40);
    expect(m.newShare).toBe(25);
    expect(m.returningShare).toBe(75);
  });

  it("never shows more than a full ring when the day is overbooked", () => {
    const m = visitMetrics({ total_visits: 26 });
    expect(m.fillPercent).toBe(100);
    expect(m.openSlots).toBe(0);
    expect(m.openPercent).toBe(0);
  });

  it("ignores malformed summary values instead of rendering NaN", () => {
    const m = visitMetrics({ total_visits: Number.NaN, new_patients: -4, returning_patients: Number.POSITIVE_INFINITY });
    expect(m.visits).toBe(0);
    expect(m.newPatients).toBe(0);
    expect(m.returningPatients).toBe(0);
    expect(m.fillPercent).toBe(0);
    expect(m.newShare).toBe(0);
  });

  it("passes the month-over-month delta through for the header chip", () => {
    expect(visitMetrics({ total_visits: 4, visits_delta_pct: 12 }).visitsDelta).toBe(12);
    expect(visitMetrics({ total_visits: 4, visits_delta_pct: 0 }).visitsDelta).toBe(0);
    expect(visitMetrics({ total_visits: 4, visits_delta_pct: null }).visitsDelta).toBeNull();
  });
});
