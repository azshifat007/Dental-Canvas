import { describe, expect, it } from "vitest";
import {
  NOW_WINDOW_MS,
  emptyChecklist,
  formatCountdown,
  localDateKey,
  nextVisit,
  parseChecklist,
  toggleChecklistItem,
  type ScheduledVisitLike,
} from "@/components/dashboard/clinic-tools-logic";

function visit(overrides: Partial<ScheduledVisitLike> & { start_time: string }): ScheduledVisitLike {
  return {
    kind: "patient",
    first_name: "Ada",
    last_name: "Lovelace",
    treatment_name: "Cleaning",
    ...overrides,
  };
}

describe("next-patient countdown", () => {
  const now = new Date("2026-10-29T10:00:00").getTime();

  it("formats short waits as starting now and longer ones in minutes or hours", () => {
    expect(formatCountdown(-5_000)).toBe("starting now");
    expect(formatCountdown(0)).toBe("starting now");
    expect(formatCountdown(30_000)).toBe("starting now");
    expect(formatCountdown(90_000)).toBe("in 2 min");
    expect(formatCountdown(12 * 60_000)).toBe("in 12 min");
    expect(formatCountdown(65 * 60_000)).toBe("in 1h 05m");
    expect(formatCountdown(120 * 60_000)).toBe("in 2h");
    // Nonsense durations must not render "in NaN min".
    expect(formatCountdown(Number.NaN)).toBe("starting now");
  });

  it("picks the earliest future visit and describes it", () => {
    const next = nextVisit(
      [
        visit({ start_time: "2026-10-29T11:30:00", treatment_name: "Crown prep" }),
        visit({ start_time: "2026-10-29T10:45:00", first_name: "Grace", last_name: "Hopper" }),
        visit({ start_time: "2026-10-29T10:20:00", first_name: "Alan", last_name: "Turing" }),
      ],
      now,
    );
    expect(next?.title).toBe("Alan Turing");
    expect(next?.detail).toBe("Cleaning");
    expect(next?.startsInMs).toBe(20 * 60_000);
    expect(next?.isNow).toBe(false);
  });

  it("skips recalls and date-only entries, which have no booked clock", () => {
    const next = nextVisit(
      [
        visit({ kind: "recall", start_time: "2026-10-29T10:05:00" }),
        visit({ start_time: "2026-10-29", first_name: "No", last_name: "Clock" }),
        visit({ start_time: "2026-10-29T13:00:00", first_name: "Real", last_name: "Visit" }),
      ],
      now,
    );
    expect(next?.title).toBe("Real Visit");
  });

  it("keeps a just-started appointment as \"now\", then moves on", () => {
    const inChair = nextVisit([visit({ start_time: "2026-10-29T09:50:00" })], now);
    expect(inChair?.isNow).toBe(true);
    expect(formatCountdown(inChair!.startsInMs)).toBe("starting now");

    // Twenty minutes past the start is outside the window; the next one wins.
    const movedOn = nextVisit(
      [
        visit({ start_time: "2026-10-29T09:40:00", first_name: "Old", last_name: "Visit" }),
        visit({ start_time: "2026-10-29T10:30:00", first_name: "Next", last_name: "Visit" }),
      ],
      now,
    );
    expect(movedOn?.title).toBe("Next Visit");
    expect(NOW_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it("falls back to the treatment and then a generic title", () => {
    const treatmentOnly = nextVisit(
      [visit({ start_time: "2026-10-29T10:15:00", first_name: null, last_name: null, treatment_name: "Extraction" })],
      now,
    );
    expect(treatmentOnly?.title).toBe("Extraction");
    expect(treatmentOnly?.detail).toBeNull();

    const bare = nextVisit(
      [visit({ start_time: "2026-10-29T10:15:00", first_name: null, last_name: null, treatment_name: null })],
      now,
    );
    expect(bare?.title).toBe("Appointment");
  });

  it("returns null when there is nothing scheduled", () => {
    expect(nextVisit([], now)).toBeNull();
    expect(nextVisit([visit({ start_time: "not a date" })], now)).toBeNull();
    expect(nextVisit([visit({ start_time: "2026-10-28T10:00:00" })], now)).toBeNull();
  });

  it("uses the local calendar day for the checklist key", () => {
    expect(localDateKey(new Date(2026, 9, 9))).toBe("2026-10-09");
    expect(localDateKey(new Date(2027, 0, 1))).toBe("2027-01-01");
  });
});

describe("sterilization checklist", () => {
  const today = "2026-10-29";

  it("starts empty when nothing is stored or the JSON is broken", () => {
    expect(parseChecklist(null, today)).toEqual({ date: today, done: [] });
    expect(parseChecklist("{not json", today)).toEqual({ date: today, done: [] });
    expect(emptyChecklist(today)).toEqual({ date: today, done: [] });
  });

  it("discards yesterday's ticks so the cycle resets at midnight", () => {
    const stored = JSON.stringify({ date: "2026-10-28", done: ["sealed", "cycle"] });
    expect(parseChecklist(stored, today)).toEqual({ date: today, done: [] });
  });

  it("keeps known ids only and removes duplicates", () => {
    const stored = JSON.stringify({
      date: today,
      done: ["sealed", "sealed", "retired-item", 42, "indicator"],
    });
    expect(parseChecklist(stored, today)).toEqual({
      date: today,
      done: ["sealed", "indicator"],
    });
  });

  it("toggles items on and off without disturbing the rest", () => {
    const start = { date: today, done: ["sealed"] };
    const added = toggleChecklistItem(start, "cycle");
    expect(added.done).toEqual(["sealed", "cycle"]);
    expect(toggleChecklistItem(added, "sealed").done).toEqual(["cycle"]);
    // Unknown ids are ignored rather than persisted forever.
    expect(toggleChecklistItem(start, "nope")).toBe(start);
  });
});
