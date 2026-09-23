/**
 * Dental Canvas OFFLINE service worker.
 *
 * Owns the app when there is no server: intercepts every same-origin request
 * under its scope and answers from either
 *   - the in-worker Hono server (src/server/index.ts) for /api/*, or
 *   - the precached Vite build for everything else (app shell, assets).
 *
 * This is what makes the Tauri desktop build work with zero network: Tauri
 * serves the static files, and this worker IS the backend, persisting to
 * IndexedDB through the sql.js adapter.
 *
 * Build notes:
 *  - Bundled by Vite as `sw.js` (see vite.config.ts entry) with a SPA-shell
 *    precache list injected at build time.
 *  - The server import is the REAL server — no fork, no drift.
 */

/// <reference lib="webworker" />

import { createOfflineD1, splitStatements, adaptSchemaForSqlJs } from "../../server/offline/sqlite-adapter";
import schemaSql from "../../server/schema.sql?raw";
import { OFFLINE_SHELL_ASSETS } from "virtual:offline-shell-assets";

declare const self: ServiceWorkerGlobalScope & {
  __OFFLINE_READY__?: boolean;
};

const SHELL_CACHE = "dental-canvas-shell-v1";

let serverFetch: ((req: Request) => Promise<Response> | Response) | null = null;
let serverReady: Promise<void> | null = null;

async function initServer(): Promise<void> {
  const d1 = await createOfflineD1({
    schemaSql,
    onSaved: () => {
      // A status probe the UI can read cheaply.
      self.__OFFLINE_READY__ = true;
    },
  });

  // Import the real server (module singletons initialize against our binding).
  const mod = await import("../../server/index");
  const app = mod.default;

  // The server expects `c.env.DB` (its Env type) — Hono's app.fetch accepts an
  // env object as the third argument; wrap fetch to pass the binding through.
  serverFetch = (req: Request) => app.fetch(req, { DB: d1 } as never);

  // Eager first request: triggers seed + column migrations while the shell
  // loads, so the app's first API call doesn't pay the startup cost.
  await serverFetch(new Request("http://localhost/api/health"));
}

self.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(OFFLINE_SHELL_ASSETS).catch(() => {
        // A missing asset (dev) must not break installation.
      });
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      // Clean old shell caches from previous builds.
      for (const name of await caches.keys()) {
        if (name !== SHELL_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
      serverReady ??= initServer();
      await serverReady;
    })(),
  );
});

self.addEventListener("fetch", (event: FetchEvent) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // ── API: answered by the in-worker server ────────────────────
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      (async () => {
        try {
          serverReady ??= initServer();
          await serverReady;
        } catch (err) {
          return new Response(JSON.stringify({ error: `Offline backend failed to start: ${(err as Error).message}` }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        try {
          return await Promise.resolve(serverFetch!(event.request));
        } catch (err) {
          return new Response(JSON.stringify({ error: `Offline server error: ${(err as Error).message}` }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      })(),
    );
    return;
  }

  // ── App shell & assets: cache-first, network fallback ────────
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);

      // SPA navigations: serve index.html.
      if (event.request.mode === "navigate") {
        const cached = await cache.match("/index.html");
        if (cached) return cached;
        return fetch(event.request);
      }

      const cached = await cache.match(event.request);
      if (cached) return cached;

      // Try the network (updates), then fall back to the precached shell.
      const network = await fetch(event.request)
        .then((r) => {
          if (r.ok && event.request.method === "GET") {
            cache.put(event.request, r.clone());
          }
          return r;
        })
        .catch(() => null);
      if (network) return network;

      // Vite hashed assets live under /assets — a miss means the cache is
      // stale; serve the shell so the app still boots.
      if (url.pathname.startsWith("/assets/")) {
        const shell = await cache.match("/index.html");
        if (shell) return shell;
      }
      return new Response("Offline and not cached", { status: 504 });
    })(),
  );
});

// Re-exported for the bundler; not used at runtime here.
export { splitStatements, adaptSchemaForSqlJs };
