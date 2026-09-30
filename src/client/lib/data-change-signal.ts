/**
 * Data-change signal — the "something important just changed" event source
 * for change-triggered auto-backups.
 *
 * The auto-backup scheduler previously ran only on a timer, so a burst of
 * morning appointments could all be lost if the interval hadn't elapsed yet.
 * Mutation code calls `notifyDataChanged()` (fire-and-forget, never throws)
 * and the auto-backup hook debounce-batches the signals into one snapshot.
 *
 * Kept deliberately dependency-free: a plain listener set, safe to import
 * from anywhere in the client without cycles.
 */

export type DataChangeReason =
  | "appointment"
  | "patient"
  | "invoice"
  | "prescription"
  | "clinical_note"
  | "medicine"
  | "inventory"
  | "waiting_list"
  | "image";

export interface DataChangeEvent {
  reason: DataChangeReason;
  at: number;
}

type Listener = (e: DataChangeEvent) => void;

const listeners = new Set<Listener>();

/** Subscribe to data-change signals. Returns an unsubscribe function. */
export function onDataChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Fire-and-forget signal that meaningful data changed. Safe to call from
 * anywhere (including inside state hooks after a successful mutation).
 */
export function notifyDataChanged(reason: DataChangeReason): void {
  const e: DataChangeEvent = { reason, at: Date.now() };
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      /* a broken listener must never break a mutation */
    }
  }
}
