/**
 * Open an external URL (https://, mailto:, tel:) in the system's default
 * browser.
 *
 * In the Tauri desktop app the WebView cannot spawn windows or tabs: plain
 * `window.open(href, "_blank")` is silently swallowed by the WebView2
 * integration, so WhatsApp share links, booking previews, and mailto links
 * did nothing on Windows. The opener plugin hands the URL to the OS shell
 * instead. In a normal browser this is just window.open.
 */

import { isTauriDesktop } from "@/offline/activate";

type OpenerModule = {
  openUrl: (url: string) => Promise<void>;
};

let openerModule: OpenerModule | null | undefined;

async function loadOpener(): Promise<OpenerModule | null> {
  if (openerModule !== undefined) return openerModule;
  try {
    openerModule = (await import("@tauri-apps/plugin-opener")) as OpenerModule;
  } catch {
    openerModule = null; // not bundled (browser/dev without Tauri)
  }
  return openerModule;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (isTauriDesktop()) {
    const opener = await loadOpener();
    if (opener) {
      try {
        await opener.openUrl(url);
        return;
      } catch {
        // Plugin/permission missing → fall through to window.open, which at
        // minimum logs and never crashes the app.
      }
    }
  }
  window.open(url, "_blank", "noopener");
}
