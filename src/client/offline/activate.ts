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

/**
 * Ask the service worker to persist any pending DB writes right now. Called
 * from main.tsx on pagehide/visibilitychange so a hard kill (Alt+F4, Windows
 * shutdown) can't lose the last 400ms of writes that the debounced saver
 * hasn't flushed yet. Fire-and-forget safe: if the SW isn't there yet, or is
 * gone with the page, nothing can be done anyway.
 */
export function flushDatabase(): void {
  navigator.serviceWorker?.controller?.postMessage("dental-canvas:flush-db");
}

export interface OfflineDbStatus {
  /** Epoch ms of the last successful DB-image persistence (0 = never). */
  lastSavedAt: number;
  /** Whether the in-worker server has initialized. */
  serverReady: boolean;
}

/**
 * Ask the service worker when the offline database last persisted. Resolves
 * null when there's no SW (browser mode) or it doesn't answer in time.
 */
export function getOfflineDbStatus(timeoutMs = 2000): Promise<OfflineDbStatus | null> {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return Promise.resolve(null);
  const sw = navigator.serviceWorker;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sw.removeEventListener("message", onMsg);
      resolve(null);
    }, timeoutMs);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "dental-canvas:status") return;
      clearTimeout(timer);
      sw.removeEventListener("message", onMsg);
      resolve({ lastSavedAt: e.data.lastSavedAt ?? 0, serverReady: !!e.data.serverReady });
    };
    sw.addEventListener("message", onMsg);
    controller.postMessage("dental-canvas:get-status");
  });
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
    // Surface a clear failure rather than a blank screen: main.tsx renders
    // the diagnostic screen with a Retry button from this message.
    (window as unknown as { __OFFLINE_ERROR__?: string }).__OFFLINE_ERROR__ =
      (err as Error).message;
    throw err;
  }
}

/**
 * Watch for a newer service worker taking over (an app update installed
 * while this window is open) and reload once so the UI matches the worker.
 * `skipWaiting` + `clients.claim` in the SW make the takeover instant; the
 * reload here just replaces the old shell assets with the new ones.
 */
export function watchForUpdates(): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // Only reload if this page was already controlled — the first claim on a
    // fresh boot is our own worker, and reloading would loop.
    if (sessionStorage.getItem("dental-canvas:had-controller") === "1") {
      window.location.reload();
    }
    sessionStorage.setItem("dental-canvas:had-controller", "1");
  });
}
