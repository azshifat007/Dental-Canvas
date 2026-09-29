import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import { isTauriDesktop } from "../offline/activate";
import { notify } from "../lib/desktop-notify";
import { api } from "../api";
import type { Appointment } from "../types";

/**
 * Appointment reminder engine.
 *
 * Watches today's appointments and raises a notification a configurable
 * number of minutes before each one starts — as an in-app toast AND (on the
 * desktop app, once the user has granted permission) as a native OS
 * notification, so reminders surface even when the window is minimized or
 * behind other windows.
 *
 * Scheduling is purely client-side (the app is serverless/offline): the list
 * of today's appointments is re-fetched on mount and every 5 minutes, each
 * reminder is armed with a setTimeout, and everything is re-armed when the
 * list changes. Reminders that would have fired while the app was closed are
 * shown once shortly after startup, marked "just started" / "started".
 *
 * Settings keys (Settings → Notifications):
 *   reminders_enabled — "1" to enable, anything else off.
 *   reminder_minutes  — minutes before the appointment (default 15).
 */

const POLL_MS = 5 * 60 * 1000;

function parseHHMM(iso: string): number {
  // start_time is "YYYY-MM-DDTHH:MM:SS" (local clinic time, no timezone).
  const m = /^(\d{2}):(\d{2})/.exec(iso.slice(11));
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function useAppointmentReminders(enabled: boolean, minutesBefore: number) {
  // Timers owned by the current effect run; cleared on re-arm/unmount.
  const timersRef = useRef<number[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function arm() {
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      let appts: Appointment[];
      try {
        appts = (await api<{ appointments: Appointment[] }>("GET", `/api/appointments?date=${ymd}`)).appointments;
      } catch {
        return; // offline or server not ready — the next poll retries
      }
      if (cancelled) return;

      const now = today.getHours() * 60 + today.getMinutes() + today.getSeconds() / 60;
      const overdue: Appointment[] = [];

      for (const a of appts) {
        // Skip cancelled/no-show appointments; an empty patient_id is a hold.
        if (a.status === "cancelled" || a.status === "no_show") continue;
        if (a.patient_id == null) continue;

        const start = parseHHMM(a.start_time);
        if (!Number.isFinite(start)) continue;
        const fireAt = start - minutesBefore;

        const patient = [a.patient_first_name, a.patient_last_name].filter(Boolean).join(" ") || "Walk-in";
        const title = a.title?.trim() || a.treatment_name?.trim() || "Appointment";
        const message = `${patient} — ${title} at ${a.start_time.slice(11, 16)}`;

        if (fireAt <= now) {
          // Missed while the app was closed (or it's starting right now):
          // show once, but only for appointments still in the near past.
          if (now - fireAt <= minutesBefore + 60) overdue.push(a);
          continue;
        }

        const delay = Math.round((fireAt - now) * 60_000);
        // Cap setTimeout (browsers clamp >2^31ms to fire immediately).
        if (delay > 2_000_000_000) continue;
        const id = window.setTimeout(() => {
          toast.info(`⏰ Upcoming: ${message}`, 10_000);
          void notify(`Appointment reminder`, { body: message });
        }, delay);
        timersRef.current.push(id);
      }

      if (overdue.length && isTauriDesktop()) {
        const names = overdue.slice(0, 3).map((a) =>
          [a.patient_first_name, a.patient_last_name].filter(Boolean).join(" ") || "Walk-in",
        );
        const rest = overdue.length > 3 ? ` +${overdue.length - 3} more` : "";
        toast.info(`⏰ Today's early appointments: ${names.join(", ")}${rest}`, 12_000);
      }
    }

    void arm();
    const poll = window.setInterval(() => void arm(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      for (const t of timersRef.current) window.clearTimeout(t);
      timersRef.current = [];
    };
  }, [enabled, minutesBefore]);
}
