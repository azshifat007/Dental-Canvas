/**
 * Dashboard visit metrics.
 *
 * Pure arithmetic behind the visits card's rings, kept out of the component so
 * the numbers can be tested without a DOM. Everything here must be derived from
 * the summary the API actually returns — no placeholder scores: a ring that
 * shows a made-up percentage is worse than no ring at all.
 */

/** Chair slots the practice is assumed to be able to see in a day. This is the
 *  same assumption the card already made for its fill-rate figure; it is a
 *  constant rather than a setting because nothing in the app configures
 *  capacity yet. */
export const DAILY_VISIT_CAPACITY = 20;

export interface VisitSummaryLike {
  total_visits?: number | null;
  new_patients?: number | null;
  returning_patients?: number | null;
  visits_delta_pct?: number | null;
}

export interface VisitMetrics {
  /** Today's patient visits (the card's headline number). */
  visits: number;
  newPatients: number;
  returningPatients: number;
  capacity: number;
  /** Today's visits as a percentage of capacity, clamped to 100. */
  fillPercent: number;
  /** Share of the patient base that has never completed a visit. */
  newShare: number;
  /** Share of the patient base with at least one completed visit. */
  returningShare: number;
  /** Chair slots still open today. */
  openSlots: number;
  /** Those free slots as a percentage of capacity. */
  openPercent: number;
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
  return (part / whole) * 100;
}

export function visitMetrics(summary: VisitSummaryLike | null | undefined): VisitMetrics {
  const visits = count(summary?.total_visits);
  const newPatients = count(summary?.new_patients);
  const returningPatients = count(summary?.returning_patients);
  const capacity = DAILY_VISIT_CAPACITY;
  // "New" excludes anyone with a completed visit, "returning" requires one
  // before this month; a patient whose only completed visit is this month is in
  // neither, so the mix is a close approximation rather than a partition.
  const knownBase = newPatients + returningPatients;
  const openSlots = Math.max(0, capacity - visits);
  const delta = summary?.visits_delta_pct;
  return {
    visits,
    newPatients,
    returningPatients,
    capacity,
    fillPercent: Math.min(100, percentOf(visits, capacity)),
    newShare: percentOf(newPatients, knownBase),
    returningShare: percentOf(returningPatients, knownBase),
    openSlots,
    openPercent: percentOf(openSlots, capacity),
    visitsDelta: typeof delta === "number" && Number.isFinite(delta) ? delta : null,
  };
}
