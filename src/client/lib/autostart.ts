/**
 * Launch at login ("start Dental Canvas when the computer starts").
 *
 * Only the desktop app can register itself with the OS, so every entry point
 * here is a no-op outside Tauri:
 *   - Windows: a value under HKCU\...\CurrentVersion\Run
 *   - macOS:   a LaunchAgent plist in ~/Library/LaunchAgents
 *   - Linux:   an XDG autostart .desktop file in ~/.config/autostart
 *
 * The plugin is imported lazily so a plain browser build never pulls the Tauri
 * bindings into the main chunk, and so a desktop bundle without the plugin
 * degrades to "unsupported" instead of failing at import time.
 */

import { isTauriDesktop } from "@/offline/activate";

type AutostartModule = {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
  isEnabled: () => Promise<boolean>;
};

let autostartModule: AutostartModule | null | undefined;

async function loadAutostart(): Promise<AutostartModule | null> {
  if (autostartModule !== undefined) return autostartModule;
  try {
    autostartModule = (await import("@tauri-apps/plugin-autostart")) as AutostartModule;
  } catch {
    autostartModule = null; // not bundled (browser/dev without Tauri)
  }
  return autostartModule;
}

/** True when the OS can be asked to launch the app at login. */
export function autostartSupported(): boolean {
  return isTauriDesktop();
}

/**
 * Whether the app currently launches at login.
 *
 * `null` means "cannot tell" — browser mode, a build without the plugin, or an
 * OS that refused the query — and the Settings toggle shows that plainly rather
 * than pretending the feature is off.
 */
export async function isAutostartEnabled(): Promise<boolean | null> {
  if (!autostartSupported()) return null;
  const plugin = await loadAutostart();
  if (!plugin) return null;
  try {
    return await plugin.isEnabled();
  } catch {
    return null;
  }
}

/**
 * Turn launch-at-login on or off. Throws with a readable message when the
 * platform cannot do it, so the caller can surface it as a toast.
 */
export async function setAutostart(enabled: boolean): Promise<void> {
  if (!autostartSupported()) {
    throw new Error("Launch at login is only available in the desktop app.");
  }
  const plugin = await loadAutostart();
  if (!plugin) {
    throw new Error("This build has no startup integration — reinstall the desktop app to enable it.");
  }
  if (enabled) await plugin.enable();
  else await plugin.disable();
}
