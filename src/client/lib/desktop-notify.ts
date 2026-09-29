/**
 * Native OS notifications (desktop app only).
 *
 * Wraps @tauri-apps/plugin-notification so callers never need to care about
 * permission state: the first call asks the OS (Windows Action Center /
 * macOS Notification Center / Linux desktop daemon), remembers the answer
 * for the session, and silently no-ops when the user declined or when the
 * app runs in a plain browser (where the in-app toast is the notification).
 *
 * In the browser the Web Notifications API is deliberately NOT used — the
 * app's own toast stack is always visible and doesn't need a permission
 * prompt on first launch of the web version.
 */

import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { isTauriDesktop } from "../offline/activate";

export interface NotifyOptions {
  body?: string;
}

let resolved: boolean | null = null; // null = not asked yet

async function ensurePermission(): Promise<boolean> {
  if (resolved !== null) return resolved;
  try {
    if (await isPermissionGranted()) {
      resolved = true;
    } else {
      resolved = (await requestPermission()) === "granted";
    }
  } catch {
    resolved = false;
  }
  return resolved;
}

/** Fire a native notification; resolves once delivered (or dropped). */
export async function notify(title: string, opts: NotifyOptions = {}): Promise<void> {
  if (!isTauriDesktop()) return;
  if (!(await ensurePermission())) return;
  try {
    sendNotification({ title, body: opts.body ?? "" });
  } catch {
    /* notification infrastructure unavailable — the toast already showed */
  }
}

/** Test hook for Settings → Notifications ("Send a test notification"). */
export async function notificationPermissionState(): Promise<"granted" | "denied" | "unknown"> {
  if (!isTauriDesktop()) return "denied";
  try {
    return (await isPermissionGranted()) ? "granted" : "unknown";
  } catch {
    return "unknown";
  }
}
