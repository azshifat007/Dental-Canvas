import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adaptSchemaForSqlJs,
  createOfflineD1,
  splitStatements,
  type D1LikeDatabase,
} from "../src/server/offline/sqlite-adapter";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const SCHEMA_SQL = readFileSync(path.join(root, "src/server/schema.sql"), "utf8");

/** Fresh adapter wired to an in-memory persistence store. */
async function freshAdapter(schemaSql = SCHEMA_SQL): Promise<{ d1: D1LikeDatabase; images: Uint8Array[] }> {
  const images: Uint8Array[] = [];
  const d1 = await createOfflineD1({
    schemaSql,
    persistence: {
      load: async () => undefined,
      save: async (img) => {
        images.push(img);
      },
    },
  });
  return { d1, images };
}

describe("offline sqlite adapter", () => {
  it("splits SQL statements respecting trigger bodies", () => {
    const sql = `
      CREATE TABLE a (id INTEGER);
      CREATE TRIGGER t AFTER INSERT ON a BEGIN
        INSERT INTO a VALUES (1); INSERT INTO a VALUES (2);
      END;
      CREATE TABLE b (id INTEGER);
    `;
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[1]).toMatch(/END;$/);
    expect(stmts[1]).toContain("INSERT INTO a VALUES (2);");
  });

  it("translates fts5 virtual tables to fts4 and drops tokenizer options", () => {
    const out = adaptSchemaForSqlJs(
      "CREATE VIRTUAL TABLE search_index USING fts5(a, b, tokenize = 'porter unicode61');",
    );
    expect(out).toContain("USING fts4");
    expect(out).not.toContain("tokenize");
    expect(out).not.toContain("fts5");
  });

  it("creates the schema and round-trips a row through the D1 shape", async () => {
    const { d1 } = await freshAdapter();

    const health = await d1.exec("SELECT 1 AS one");
    expect(health.success).toBe(true);

    await d1.exec(
      "INSERT INTO settings (key, value) VALUES ('test_key', 'test_value')",
    );
    // The server (@clawnify/db d1Impl) always chains .bind(...params):
    const row = await d1
      .prepare("SELECT value FROM settings WHERE key = ?")
      .bind("test_key")
      .first<{ value: string }>();
    expect(row?.value).toBe("test_value");
  });

  it("reports changes and last_row_id like D1", async () => {
    const { d1 } = await freshAdapter();
    const r = await d1
      .prepare("INSERT INTO operatories (name, color, sort_order) VALUES (?, ?, ?)")
      .bind("Chair 1", "#ff0000", 1)
      .run();
    expect(r.meta.changes).toBe(1);
    expect(r.meta.last_row_id).toBeGreaterThan(0);
  });

  it("persists data across adapter restarts via the persistence store", async () => {
    // Shared store simulating IndexedDB across two "boots".
    let stored: Uint8Array | undefined;
    const persistence = {
      load: async () => stored,
      save: async (img: Uint8Array) => {
        stored = img;
      },
    };

    const first = await createOfflineD1({ schemaSql: SCHEMA_SQL, persistence });
    await first
      .prepare("INSERT INTO operatories (name, color, sort_order) VALUES (?, ?, ?)")
      .bind("Persisted Chair", "#00ff00", 9)
      .run();
    // Force the debounced save to flush.
    await new Promise((r) => setTimeout(r, 600));
    expect(stored).toBeDefined();

    const second = await createOfflineD1({ schemaSql: SCHEMA_SQL, persistence });
    const row = await second
      .prepare("SELECT name FROM operatories WHERE sort_order = 9")
      .first<{ name: string }>();
    expect(row?.name).toBe("Persisted Chair");
  });

  it("runs the server's seed lifecycle over the adapter (end-to-end)", async () => {
    const { d1 } = await freshAdapter();
    // Mimic what the server middleware does on first request: the seed check
    // reads COUNT(*) — proving schema + queries work on this engine.
    const r = await d1.prepare("SELECT COUNT(*) AS n FROM operatories").first<{ n: number }>();
    expect(r?.n).toBe(0);
  });
});
