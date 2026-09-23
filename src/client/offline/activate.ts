/**
 * Offline-mode activation.
 *
 * Called once from main.tsx BEFORE the React app mounts. The rule:
 *   - Tauri desktop (window.__TAURI_INTERNALS__ present) → offline mode ON.
 *     Register /sw.js and wait until the in-worker server answers /api/health,
 *     because the UI's first data fetch races the server otherwise.
 *   - Plain browser → never register; the Cloudflare Worker serves /api.
 *
 * The service worker intercepts fetch()es, so no other code path changes:
 * `api.ts` keeps issuing same-origin /api requests and works against either
 * backend transparently.
 */

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** True once the offline server has answered a health probe (SW active). */
let offlineReady = false;

export function isOfflineReady(): boolean {
  return offlineReady;
}

export async function activateOfflineMode(): Promise<void> {
  if (!isTauriDesktop() || !("serviceWorker" in navigator)) return;

  try {
    // The SW is registered at scope "/" so it owns both /api and the shell.
    // Module worker: the Vite bundle is ESM (it code-splits shared helpers).
    const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", type: "module" });

    // If the worker is already active, wait for it to control this page.
    // Otherwise the activate handler finishes initializing the server.
    await navigator.serviceWorker.ready;

    // Probe until the in-worker server answers — seed+migrations run during
    // activate, and sql.js WASM compilation takes a moment.
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        const j = (await r.json()) as { ok?: boolean };
        if (j.ok) {
          offlineReady = true;
          return;
        }
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error("Offline server did not become ready within 30s");
  } catch (err) {
    // Surface a clear failure rather than a blank screen: the app shell will
    // show the message through the offline-gate below.
    (window as unknown as { __OFFLINE_ERROR__?: string }).__OFFLINE_ERROR__ =
      (err as Error).message;
    throw err;
  }
}
