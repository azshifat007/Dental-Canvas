/**
 * In-page offline backend for Android (and any Tauri mobile shell).
 *
 * Android's system WebView will not register a service worker for the
 * `tauri.localhost` origin (custom-scheme virtual origins have no SW
 * storage) — the desktop offline path fails there with "Failed to register
 * a ServiceWorker". The backend itself, however, runs fine anywhere: the
 * same Hono app + sql.js D1 adapter used inside the service worker is
 * invoked directly through `app.fetch()` with a `window.fetch` shim, so
 * `api.ts`'s same-origin `/api/...` requests are answered in-process.
 *
 * Differences vs the desktop SW path:
 *   - no shell precache (Tauri serves the assets directly, offline-capable
 *     by construction on mobile),
 *   - DB flushes are scheduled on the same page lifecycle events instead of
 *     SW messages (the page owns the database here).
 */

import { createOfflineD1 } from "../../server/offline/sqlite-adapter";
import schemaSql from "../../server/schema.sql?raw";

let liveDb: { flush(): Promise<void>; lastSavedAt?(): number } | null = null;
let ready: Promise<void> | null = null;

/** Minimal structural fetch type — the DOM lib's window.fetch has extra
 * Cloudflare-flavored overloads that don't round-trip through variables. */
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** The original window.fetch, captured before the shim replaces it. */
let nativeFetch: FetchLike | null = null;

export function isInPageOfflineMode(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window &&
    !isDesktopPlatform()
  );
}

function isDesktopPlatform(): boolean {
  // The Tauri v2 user agent carries the platform on desktop only.
  const ua = navigator.userAgent;
  return /Windows|Macintosh|Linux/.test(ua) && !/Android|iPhone|iPad|Mobile/.test(ua);
}

/** Epoch ms of the last DB image persistence (0 = never). */
export function inPageLastSavedAt(): number {
  return liveDb?.lastSavedAt?.() ?? 0;
}

/** True once the in-page server has booted (used to route DB flushes). */
export function isInPageServerLive(): boolean {
  return liveDb !== null;
}

/**
 * Boot the in-page backend (idempotent). Resolves once the server has
 * seeded/migrated and answered its first health probe, so the app's first
 * real fetch finds a ready server — mirroring the desktop boot contract.
 */
export function startInPageOfflineMode(): Promise<void> {
  ready ??= start();
  return ready;
}

/** Persist pending writes; wired to pagehide/visibilitychange by main.tsx. */
export async function flushInPageDatabase(): Promise<void> {
  ready ??= start();
  await ready.catch(() => undefined);
  await liveDb?.flush().catch(() => undefined);
}

async function start(): Promise<void> {
  const d1 = await createOfflineD1({ schemaSql });
  liveDb = d1;

  const mod = await import("../../server/index");
  const app = mod.default;
  const serverFetch = (req: Request) => app.fetch(req, { DB: d1 } as never);

  // Eager first request: seed + migrations warm up while the shell loads.
  await Promise.resolve(serverFetch(new Request("http://localhost/api/health"))).catch(() => undefined);

  nativeFetch = window.fetch.bind(window) as FetchLike;
  const shim: FetchLike = (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input.toString() : input.url,
      window.location.origin,
    );
    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
      return Promise.resolve(serverFetch(new Request(url.toString(), init)));
    }
    return nativeFetch!(input, init);
  };
  window.fetch = shim as typeof window.fetch;
}
