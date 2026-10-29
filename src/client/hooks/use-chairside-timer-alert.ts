import { useEffect } from "react";
import {
  CHAIRSIDE_TIMER_EVENT,
  cancelChairsideTimerAlert,
  syncChairsideTimerAlert,
} from "../lib/chairside-timer-alert";

/**
 * App-level watcher for the dashboard's chairside timer.
 *
 * Mounted once in <App /> so the finish alert does not depend on the dashboard
 * being on screen. On start it picks up a session that was already running
 * (reload, route change) and on every timer state change it re-reads the saved
 * session; a timer that passes its deadline while the user is elsewhere still
 * reaches the OS notification center.
 */
export function useChairsideTimerAlert() {
  useEffect(() => {
    syncChairsideTimerAlert();

    const resync = () => syncChairsideTimerAlert();
    window.addEventListener(CHAIRSIDE_TIMER_EVENT, resync);
    window.addEventListener("storage", resync);
    // Background tabs throttle timers; catch up as soon as we are visible.
    const onVisibility = () => {
      if (document.visibilityState === "visible") syncChairsideTimerAlert();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener(CHAIRSIDE_TIMER_EVENT, resync);
      window.removeEventListener("storage", resync);
      document.removeEventListener("visibilitychange", onVisibility);
      cancelChairsideTimerAlert();
    };
  }, []);
}
