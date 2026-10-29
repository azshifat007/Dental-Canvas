/**
 * Chairside timer finish alert.
 *
 * The timer itself lives on the dashboard, so navigating to Patients used to
 * lose the only signal that a cycle had ended (the card simply restored a
 * finished state when you came back). This module owns a single app-level
 * timeout keyed to the saved session's wall-clock deadline, so the native OS
 * notification fires while the user is on another page or in another window.
 *
 * The timer component writes its session to localStorage and dispatches
 * CHAIRSIDE_TIMER_EVENT whenever running/minutes change; the App-level hook
 * (hooks/use-chairside-timer-alert.ts) re-arms from that event. Pausing or
 * resetting clears the pending alert. A session restored after its deadline
 * (app was closed) never raises a stale alert.
 */

import { notify } from "./desktop-notify";
import { toast } from "@/components/ui/toast";

export const CHAIRSIDE_TIMER_STORAGE_KEY = "dental-canvas:chairside-timer";
export const CHAIRSIDE_TIMER_EVENT = "dental-canvas:chairside-timer-change";

interface ChairsideSnapshot {
  minutes: number;
  remaining: number;
  deadline: number | null;
}

function readSnapshot(): ChairsideSnapshot | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CHAIRSIDE_TIMER_STORAGE_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<ChairsideSnapshot>;
    if (typeof saved.minutes !== "number" || !Number.isFinite(saved.minutes)) return null;
    if (typeof saved.remaining !== "number" || !Number.isFinite(saved.remaining)) return null;
    return {
      minutes: Math.max(1, Math.round(saved.minutes)),
      remaining: Math.max(0, Math.round(saved.remaining)),
      deadline: typeof saved.deadline === "number" && Number.isFinite(saved.deadline) ? saved.deadline : null,
    };
  } catch {
    return null;
  }
}

/** The cycle currently watched, kept in memory so a pause cannot fire it. */
let armed: { deadline: number; minutes: number } | null = null;
/** Deadline already announced, so two paths cannot notify for the same cycle. */
let notifiedFor: number | null = null;
let timeoutId: number | null = null;

function clearPendingTimeout() {
  if (timeoutId !== null) {
    window.clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function fire(deadline: number, minutes: number) {
  if (notifiedFor === deadline) return;
  notifiedFor = deadline;
  const message = `The ${minutes}-minute cycle is up — time to head back to the chair.`;
  // The toast is the signal in the browser build (and a visible copy on the
  // desktop); the native notification is what reaches the clinic when the
  // window is behind another app.
  toast.info(`Chairside timer finished — the ${minutes}-minute cycle is up.`, 10_000);
  void notify("Chairside timer finished", { body: message });
}

/**
 * Re-read the saved session and (re)arm the finish alert.
 *
 * Called on app start, on every timer state change, and when the window
 * becomes visible again (background timing can be throttled, so a missed
 * deadline is caught up on return).
 */
export function syncChairsideTimerAlert(): void {
  const snap = readSnapshot();
  clearPendingTimeout();

  if (!snap) {
    armed = null;
    return;
  }

  const now = Date.now();
  const deadline = snap.deadline;
  if (deadline !== null && deadline > now) {
    armed = { deadline, minutes: snap.minutes };
    timeoutId = window.setTimeout(() => {
      timeoutId = null;
      fire(deadline, snap.minutes);
    }, deadline - now);
    return;
  }

  // No future deadline: either the session just finished (the component writes
  // remaining 0) or it was paused/reset. Only an armed cycle that has reached
  // its deadline alerts — pausing early must stay silent.
  if (armed && now >= armed.deadline) {
    fire(armed.deadline, armed.minutes);
  }
  armed = null;
}

/** Drop the pending alert without firing it (app teardown). */
export function cancelChairsideTimerAlert(): void {
  clearPendingTimeout();
  armed = null;
}
