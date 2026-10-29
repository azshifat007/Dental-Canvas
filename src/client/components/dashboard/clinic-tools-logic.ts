/**
 * Pure logic for the dashboard's clinic tools — the next-patient countdown and
 * the daily sterilization checklist. Kept out of the component so the tricky
 * bits (past appointments, day rollover, corrupt localStorage) can be tested.
 */

export interface ScheduledVisitLike {
  kind: string;
  start_time: string;
  first_name: string | null;
  last_name: string | null;
  treatment_name: string | null;
}

export interface NextVisit {
  /** Patient name, or the treatment when the visit has no patient attached. */
  title: string;
  /** Treatment (or nothing when it is already the title). */
  detail: string | null;
  /** Epoch ms of the appointment start. */
  startsAt: number;
  /** Signed ms until the start; negative once it has started. */
  startsInMs: number;
  /** True while the appointment is inside its "starting now" window. */
  isNow: boolean;
}

/** An appointment that started up to 15 minutes ago is still "now"; after that
 *  it is in the past and the card should move on to the next one. */
export const NOW_WINDOW_MS = 15 * 60 * 1000;

/**
 * "starting now" under a minute, "in 12 min" under an hour, "in 2h 05m" above.
 * A negative or non-finite duration is treated as starting now.
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "starting now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `in ${hours}h` : `in ${hours}h ${String(rest).padStart(2, "0")}m`;
}

/** Local calendar day (yyyy-mm-dd), not UTC: the checklist resets at midnight
 *  where the clinic is, the same way the dashboard's day does. */
export function localDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The next scheduled patient visit. Recalls (`kind: "recall"`) are due dates,
 * not booked times, and date-only entries have no clock — both are skipped.
 * Past appointments are skipped once they fall outside NOW_WINDOW_MS.
 */
export function nextVisit(
  events: readonly ScheduledVisitLike[],
  now: number,
): NextVisit | null {
  const upcoming = events
    .filter((event) => event.kind !== "recall" && event.start_time.length > 10)
    .map((event) => ({ event, startsAt: new Date(event.start_time).getTime() }))
    .filter(({ startsAt }) => Number.isFinite(startsAt) && startsAt >= now - NOW_WINDOW_MS)
    .sort((a, b) => a.startsAt - b.startsAt);

  const first = upcoming[0];
  if (!first) return null;

  const patient = [first.event.first_name, first.event.last_name].filter(Boolean).join(" ").trim();
  const treatment = first.event.treatment_name?.trim() || null;
  const startsInMs = first.startsAt - now;

  return {
    title: patient || treatment || "Appointment",
    detail: patient ? treatment : null,
    startsAt: first.startsAt,
    startsInMs,
    isNow: startsInMs <= 0,
  };
}

// ── Sterilization checklist ────────────────────────────────────────

export interface ChecklistItem {
  id: string;
  label: string;
}

/** The four checks a sterilization cycle needs before the tray goes back on
 *  the shelf. Short on purpose — it is a front-desk reminder, not a logbook. */
export const STERILIZATION_ITEMS: readonly ChecklistItem[] = [
  { id: "sealed", label: "Pouches sealed & dated" },
  { id: "cycle", label: "Autoclave cycle logged" },
  { id: "indicator", label: "Indicator strip passed" },
  { id: "handpieces", label: "Handpieces bagged" },
];

export interface ChecklistState {
  /** Local day the ticks belong to. */
  date: string;
  /** Ids of the completed items. */
  done: string[];
}

/** A fresh, empty list for the given day. */
export function emptyChecklist(today: string): ChecklistState {
  return { date: today, done: [] };
}

/**
 * Parse the stored checklist, discarding ticks from another day and ids that
 * no longer exist in the list (so renaming an item cannot resurrect it).
 */
export function parseChecklist(raw: string | null, today: string): ChecklistState {
  if (!raw) return emptyChecklist(today);
  try {
    const parsed = JSON.parse(raw) as Partial<ChecklistState>;
    if (parsed.date !== today || !Array.isArray(parsed.done)) return emptyChecklist(today);
    const known = new Set(STERILIZATION_ITEMS.map((item) => item.id));
    return {
      date: today,
      done: [...new Set(parsed.done.filter((id): id is string => typeof id === "string" && known.has(id)))],
    };
  } catch {
    return emptyChecklist(today);
  }
}

/** Toggle one item, keeping the stored order stable for the progress count. */
export function toggleChecklistItem(state: ChecklistState, id: string): ChecklistState {
  if (!STERILIZATION_ITEMS.some((item) => item.id === id)) return state;
  const done = state.done.includes(id)
    ? state.done.filter((entry) => entry !== id)
    : [...state.done, id];
  return { ...state, done };
}
