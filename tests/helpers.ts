import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import { vi } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCHEMA_SQL = readFileSync(path.join(root, "src/server/schema.sql"), "utf8");

/** Remove full-line comments (D1 exec treats comment-only chunks as errors). */
function stripFullLineComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !/^[ \t]*--/.test(line))
    .join("\n");
}

/**
 * Split SQL into statements. D1's exec() splits naively on semicolons, which
 * breaks trigger bodies (internal statements end with `;`). We split on `;`,
 * except that a statement starting with CREATE TRIGGER only ends at `END;`.
 */
function splitStatements(sql: string): string[] {
  const stmts: string[] = [];
  let cur = "";
  let inTrigger = false;
  for (const ch of sql) {
    cur += ch;
    if (ch !== ";") continue;
    const body = cur.slice(0, -1).trimEnd();
    if (!inTrigger) {
      // NOTE: ^\s* — cur carries leading newlines left over from the previous
      // statement, and only the tail is trimmed.
      if (/^\s*CREATE\s+TRIGGER/i.test(body)) {
        inTrigger = true; // keep accumulating through the body
        continue;
      }
      stmts.push(cur.trim());
      cur = "";
    } else if (/\bEND$/i.test(body)) {
      stmts.push(cur.trim());
      cur = "";
      inTrigger = false;
    }
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts.filter((s) => s.length > 0);
}

export interface TestContext {
  db: D1Database;
  /** Drop every user table/trigger and re-apply schema.sql (fresh DB state). */
  resetDb: () => Promise<void>;
  dispose: () => Promise<void>;
}

/**
 * One Miniflare instance per test file; `resetDb()` gives every test a clean
 * database by dropping user objects and re-applying the real schema.sql.
 * Uses actual workerd D1 semantics — the FTS5 index and triggers behave
 * exactly as in production.
 */
export async function createTestContext(): Promise<TestContext> {
  const mf = new Miniflare({
    modules: true,
    compatibilityDate: "2025-04-01",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: ["DB"],
    // Bindings-only runtime; the script itself is never exercised.
    script: "export default { fetch() { return new Response('ok'); } }",
  });

  const db = (await mf.getD1Database("DB")) as unknown as D1Database;

  async function listUserObjects(): Promise<{ type: string; name: string }[]> {
    const res = await db
      .prepare(
        "SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'",
      )
      .all<{ type: string; name: string }>();
    return res.results ?? [];
  }

  return {
    db,
    async resetDb() {
      const objects = await listUserObjects();
      for (const o of objects) {
        if (o.type === "trigger") {
          await db.prepare(`DROP TRIGGER IF EXISTS "${o.name}"`).run();
        }
      }
      // Drop in dependency order (children first) — D1's FK enforcement can
      // not be toggled reliably per-session, and PRAGMA has no effect here.
      const order = [
        "invoice_payments",
        "prescription_items",
        "prescriptions",
        "patient_images",
        "patient_image_blobs",
        "invoice_items",
        "invoices",
        "treatment_plan_items",
        "clinical_notes",
        "tooth_conditions",
        "waiting_list",
        "insurance_plans",
        "lab_cases",
        "appointments_to_make",
        "dentist_notes",
        "backups",
        "inventory_alerts",
        "inventory_movements",
        "inventory_items",
        "appointments",
        "patients",
        "treatment_types",
        "practitioners",
        "operatories",
        "settings",
        "search_index",
      ];
      for (const name of order) {
        // Skip FTS5 shadow tables (search_index_data, …) — they are dropped
        // automatically with the virtual table itself.
        if (name === "search_index" || !name.startsWith("search_index_")) {
          await db.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
        }
      }
      for (const stmt of splitStatements(stripFullLineComments(SCHEMA_SQL))) {
        await db.prepare(stmt).run();
      }
    },
    async dispose() {
      await mf.dispose();
    },
  };
}

/**
 * Import the Hono app with a fresh module registry. The server keeps
 * per-isolate state in module singletons (`seeded`, `backfilled`); resetting
 * modules gives each test a clean first-request lifecycle.
 */
export async function freshApp() {
  vi.resetModules();
  const mod = await import("../src/server/index");
  return mod.default;
}

/** JSON request helper against the app, typed like fetch init. */
export function jsonRequest(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): { method: string; path: string; init: RequestInit } {
  return {
    method,
    path,
    init: {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  };
}
