#!/usr/bin/env node
/**
 * Shadowed-source guard.
 *
 * Vite/Node resolve extensionless imports with `.js` BEFORE `.ts`/`.tsx`
 * (default `resolve.extensions` = .mjs, .js, .mts, .ts, .jsx, .tsx, .json).
 * A committed `foo.js` sitting next to `foo.tsx` therefore silently wins:
 *
 *   import { MedicinesTab } from "./medicines-tab"   →  medicines-tab.js
 *
 * That is exactly how the medicines scroll fix kept "not working" for four
 * releases — every edit landed in medicines-tab.tsx while the bundle compiled
 * medicines-tab.js. `tsc --noEmit` happily passed (it never reads the .js), so
 * only the built output showed it. This guard makes the whole class impossible:
 * a emitted/stray .js next to a real source file fails the build.
 *
 * Run: node scripts/check-shadowed-sources.mjs   (wired into `npm run build`
 * and the CI verify job).
 */

import fs from "node:fs";
import path from "node:path";

const ROOTS = ["src", "scripts"];
const SOURCE_EXTS = [".ts", ".tsx"];
const SHADOW_EXTS = [".js", ".mjs", ".cjs"];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "target") continue;
      walk(p, out);
    } else {
      out.push(p);
    }
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  const files = walk(root);
  const byDir = new Map();
  for (const f of files) {
    const dir = path.dirname(f);
    const base = path.basename(f, path.extname(f));
    if (!byDir.has(dir)) byDir.set(dir, new Map());
    const group = byDir.get(dir);
    if (!group.has(base)) group.set(base, []);
    group.get(base).push(path.extname(f));
  }
  for (const [dir, group] of byDir) {
    for (const [base, exts] of group) {
      const hasSource = exts.some((e) => SOURCE_EXTS.includes(e));
      const shadow = exts.filter((e) => SHADOW_EXTS.includes(e));
      if (hasSource && shadow.length > 0) {
        problems.push(`${path.join(dir, base)}{${shadow.join(",")}} shadows a .ts/.tsx of the same name`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`\nshadowed-source guard: ${problems.length} problem(s) found\n`);
  for (const p of problems) console.error("  ✗ " + p + "\n");
  console.error(
    "Vite resolves .js before .ts/.tsx, so these compiled files silently replace the\n" +
      "real source at build time — edits to the .ts/.tsx never ship. Delete the .js/.mjs/.cjs\n" +
      "files (they are build artifacts, not sources) and rebuild.",
  );
  process.exit(1);
}

console.log("shadowed-source guard: OK (no .js files shadow a .ts/.tsx)");
