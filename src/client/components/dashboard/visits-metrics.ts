/**
 * Dashboard visit metrics.
 *
 * Pure arithmetic behind the visits card's rings, kept out of the component so
 * the numbers can be tested without a DOM. Everything here must be derived from
 * the summary the API actually returns — no placeholder scores: a ring that
 * shows a made-up percentage is worse than no ring at all.
 *
 * Each ring answers a different question, so no figure is shown twice:
 *   - big ring      → how full is the day (visits / chair slots)
 *   - New patients  → progress toward the daily new-patient goal
 *   - Returning     → share of today's visits by known patients
 *   - Open chairs   → what is still bookable today
 */

/** Chair slots the practice is assumed to be able to see in a day. This is the
 *  same assumption the card already made for its fill-rate figure; it is a
 *  constant rather than a setting because nothing in the app configures
 *  capacity yet. */
export const DAILY_VISIT_CAPACITY = 20;

/** New patients the practice aims to see per day. A ring needs a scale to
 *  sweep across, and "share of the patient base" gave it none — a practice
 *  with history pinned every day at ~100%. Ten a day is the front-desk goal;
 *  it is a constant because nothing in Settings configures it yet. */
export const NEW_PATIENT_DAILY_TARGET = 10;

export interface VisitSummaryLike {
  total_visits?: number | null;
  new_patients_today?: number | null;
  returning_patients_today?: number | null;
  visits_delta_pct?: number | null;
}

export interface VisitMetrics {
  /** Today's patient visits (the card's headline number). */
  visits: number;
  capacity: number;
  /** Today's visits as a percentage of capacity, clamped to 100. */
  fillPercent: number;
  /** Chair slots still open today. */
  openSlots: number;
  /** Those free slots as a percentage of capacity. */
  openPercent: number;
  /** New patients in the chair today (no completed visit before today). */
  newToday: number;
  /** Returning patients in the chair today (a completed visit before today). */
  returningToday: number;
  /** The daily new-patient goal the "New patients" ring is measured against. */
  newGoal: number;
  /** Progress toward that goal, clamped to 100. */
  newGoalPercent: number;
  /** New patients still needed to reach today's goal (0 once it is met). */
  newGoalRemaining: number;
  /** Returning patients as a share of today's visits, clamped to 100. */
  returningShare: number;
  /** Visits vs the same day last month; `null` when there is nothing to compare. */
  visitsDelta: number | null;
}

/** Non-negative whole count; anything missing or malformed counts as zero. */
function count(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
  return Math.round(value);
}

function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, (part / whole) * 100);
}

export function visitMetrics(summary: VisitSummaryLike | null | undefined): VisitMetrics {
  const visits = count(summary?.total_visits);
  const newToday = count(summary?.new_patients_today);
  const returningToday = count(summary?.returning_patients_today);
  const capacity = DAILY_VISIT_CAPACITY;
  const newGoal = NEW_PATIENT_DAILY_TARGET;
  const openSlots = Math.max(0, capacity - visits);
  const delta = summary?.visits_delta_pct;
  return {
    visits,
    capacity,
    fillPercent: percentOf(visits, capacity),
    openSlots,
    openPercent: percentOf(openSlots, capacity),
    newToday,
    returningToday,
    newGoal,
    newGoalPercent: percentOf(newToday, newGoal),
    newGoalRemaining: Math.max(0, newGoal - newToday),
    // A visit is either a new or a returning patient's; when the counts do not
    // add up (a first visit completed today is neither) the share stays honest
    // by dividing by the visits actually recorded.
    returningShare: percentOf(returningToday, visits),
    visitsDelta: typeof delta === "number" && Number.isFinite(delta) ? delta : null,
  };
}
