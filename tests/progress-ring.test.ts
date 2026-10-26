import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampPercent, ringGeometry, MiniStatRing, ProgressRing } from "@/components/ui/progress-ring";
import {
  DAILY_VISIT_CAPACITY,
  NEW_PATIENT_DAILY_TARGET,
  visitMetrics,
} from "@/components/dashboard/visits-metrics";

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

  it("shows a goal counter instead of the percentage when asked", () => {
    // A ring measured against a target is only meaningful with both numbers
    // visible — "30%" says nothing about 3 of 10 patients.
    const html = renderToStaticMarkup(
      createElement(MiniStatRing, {
        icon: createElement("span", null, "x"),
        value: 30,
        label: "New patients",
        display: "3/10",
        ariaLabel: "New patients today: 3 of 10",
      }),
    );
    expect(html).toContain("3/10");
    expect(html).toContain('aria-label="New patients today: 3 of 10"');
    // The ring itself still carries the clamped percentage.
    expect(html).toContain('aria-valuenow="30"');
  });
});

describe("dashboard visit metrics", () => {
  it("returns zeros, not NaN, for a practice with no visits", () => {
    const m = visitMetrics(null);
    expect(m).toMatchObject({
      visits: 0,
      fillPercent: 0,
      newToday: 0,
      returningToday: 0,
      newGoalPercent: 0,
      newGoalRemaining: NEW_PATIENT_DAILY_TARGET,
      returningShare: 0,
      openPercent: 100,
    });
    expect(m.newGoal).toBe(10);
    expect(m.visitsDelta).toBeNull();
    for (const value of Object.values(m)) {
      expect(Number.isNaN(value)).toBe(false);
    }
  });

  it("measures today's visits against the day's chair slots", () => {
    const m = visitMetrics({ total_visits: 12 });
    expect(m.capacity).toBe(DAILY_VISIT_CAPACITY);
    expect(m.fillPercent).toBe(60);
    expect(m.openSlots).toBe(8);
    expect(m.openPercent).toBe(40);
  });

  it("measures new patients against the ten-a-day goal", () => {
    const four = visitMetrics({ total_visits: 4, new_patients_today: 4 });
    expect(four.newGoal).toBe(NEW_PATIENT_DAILY_TARGET);
    expect(four.newGoalPercent).toBe(40);
    expect(four.newGoalRemaining).toBe(6);

    const met = visitMetrics({ total_visits: 10, new_patients_today: 10 });
    expect(met.newGoalPercent).toBe(100);
    expect(met.newGoalRemaining).toBe(0);

    // Twelve new patients is not "120%": the ring is full and the goal is met.
    const exceeded = visitMetrics({ total_visits: 14, new_patients_today: 12 });
    expect(exceeded.newGoalPercent).toBe(100);
    expect(exceeded.newGoalRemaining).toBe(0);
  });

  it("shows returning patients as a share of today's visits", () => {
    const m = visitMetrics({ total_visits: 4, new_patients_today: 1, returning_patients_today: 3 });
    expect(m.returningShare).toBe(75);
    // No visits at all: a share of nothing is 0, not NaN or 100.
    expect(visitMetrics({ total_visits: 0, returning_patients_today: 2 }).returningShare).toBe(0);
  });

  it("never shows more than a full ring when the day is overbooked", () => {
    const m = visitMetrics({ total_visits: 26 });
    expect(m.fillPercent).toBe(100);
    expect(m.openSlots).toBe(0);
    expect(m.openPercent).toBe(0);
  });

  it("ignores malformed summary values instead of rendering NaN", () => {
    const m = visitMetrics({
      total_visits: Number.NaN,
      new_patients_today: -4,
      returning_patients_today: Number.POSITIVE_INFINITY,
    });
    expect(m.visits).toBe(0);
    expect(m.newToday).toBe(0);
    expect(m.returningToday).toBe(0);
    expect(m.fillPercent).toBe(0);
    expect(m.newGoalPercent).toBe(0);
    expect(m.returningShare).toBe(0);
  });

  it("passes the month-over-month delta through for the header chip", () => {
    expect(visitMetrics({ total_visits: 4, visits_delta_pct: 12 }).visitsDelta).toBe(12);
    expect(visitMetrics({ total_visits: 4, visits_delta_pct: 0 }).visitsDelta).toBe(0);
    expect(visitMetrics({ total_visits: 4, visits_delta_pct: null }).visitsDelta).toBeNull();
  });
});
