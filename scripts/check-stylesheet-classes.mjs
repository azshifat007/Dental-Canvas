#!/usr/bin/env node
/**
 * Stylesheet class guard.
 *
 * Tailwind decides which utilities exist by scanning source files, so anything
 * that widens or narrows the scan silently changes the built CSS — and with it
 * the asset hash, `sw.js` and every release package's `rootHash`. That is how a
 * `.deb` payload extracted into the repo root once changed the stylesheet on
 * one machine and made local builds disagree with CI for a whole release.
 *
 * `src/client/styles.css` pins the scan to `src/` and `index.html`
 * (`source(none)` + explicit `@source`), which stops the common accident. This
 * guard covers the rest: it compares the class set of the built stylesheet with
 * the snapshot of what the previous release shipped, and fails on a single
 * added or removed class. A change is then either intentional — refresh the
 * snapshot with `--write` and commit it next to the styling change — or a scan
 * that reached files nobody wrote, which is what this exists to catch.
 *
 * Usage:
 *   node scripts/check-stylesheet-classes.mjs               # check dist/
 *   node scripts/check-stylesheet-classes.mjs --write       # rewrite snapshot
 *   node scripts/check-stylesheet-classes.mjs --dist <dir>  # e.g. a tag build
 *   node scripts/check-stylesheet-classes.mjs --file <path> # other snapshot
 *
 * Wired into `npm run build` and the CI verify job (`npm run lint:classes`).
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SNAPSHOT = "scripts/stylesheet-classes.txt";
const DEFAULT_DIST = "dist";
/** Below this, extraction is broken rather than the app being tiny — writing
 *  such a snapshot would silently disable the guard. */
const MIN_PLAUSIBLE_CLASSES = 100;
const MAX_LISTED = 40;

function value(argv, i, flag) {
  const v = argv[i];
  if (!v || v.startsWith("--")) {
    console.error(`${flag} needs a value`);
    process.exit(2);
  }
  return v;
}

function parseArgs(argv) {
  const opts = { dist: DEFAULT_DIST, file: SNAPSHOT, write: false, note: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") opts.write = true;
    else if (a === "--dist") opts.dist = value(argv, ++i, a);
    else if (a === "--file") opts.file = value(argv, ++i, a);
    else if (a === "--note") opts.note = value(argv, ++i, a);
    else if (a === "--help" || a === "-h") {
      console.log("usage: check-stylesheet-classes.mjs [--write] [--dist <dir>] [--file <path>] [--note <text>]");
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      process.exit(2);
    }
  }
  return opts;
}

/** Selector/prelude text of every rule block, in source order.
 *
 * A brace scanner rather than a regex over the whole file: declaration values
 * contain `.` (0.5rem, url(...), rgba(0,0,0,.5)) and would otherwise show up as
 * class names. Comments, quoted strings and at-rule preludes are tracked so
 * only real selector text is returned. */
export function ruleSelectors(css) {
  const out = [];
  let buf = "";
  let inComment = false;
  let quote = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (inComment) {
      if (ch === "*" && css[i + 1] === "/") {
        inComment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && css[i + 1] === "*") {
      inComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      out.push(buf);
      buf = "";
      continue;
    }
    if (ch === "}" || ch === ";") {
      buf = "";
      continue;
    }
    buf += ch;
  }
  return out;
}

/** Class names appearing in a stylesheet, unescaped and deduplicated.
 *
 * Tailwind escapes CSS-special characters in class names (`.top-1\/2`,
 * `.hover\:bg-red-500`, `.-top-\[3px\]`); the backslash is removed so the set
 * matches what the source files say. */
export function classNames(css) {
  const found = new Set();
  for (const raw of ruleSelectors(css)) {
    const selector = raw.trim();
    if (!selector || selector.startsWith("@")) continue; // @media, @keyframes, @property
    // Attribute-selector values could contain dots ("[href$='.pdf']").
    const bare = selector.replace(/"[^"]*"|'[^']*'/g, "");
    for (const m of bare.matchAll(/\.((?:\\.|[A-Za-z0-9_-])+)/g)) {
      const name = m[1].replace(/\\(.)/g, "$1");
      if (!name || /^[0-9.]+$/.test(name)) continue;
      found.add(name);
    }
  }
  return found;
}

function stylesheetFiles(dist) {
  const dir = path.join(dist, "assets");
  if (!fs.existsSync(dir)) {
    console.error(`stylesheet class guard: no ${dir}/ — run the build first (pnpm run build)`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".css"))
    .sort()
    .map((n) => path.join(dir, n));
  if (files.length === 0) {
    console.error(`stylesheet class guard: no .css in ${dir}/ — run the build first`);
    process.exit(1);
  }
  return files;
}

function builtClasses(dist) {
  const files = stylesheetFiles(dist);
  const all = new Set();
  for (const f of files) {
    for (const name of classNames(fs.readFileSync(f, "utf8"))) all.add(name);
  }
  return { classes: [...all].sort(), files };
}

function readSnapshot(file) {
  const text = fs.readFileSync(file, "utf8");
  const classes = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  return new Set(classes);
}

function gitInfo() {
  const run = (args) => {
    try {
      return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  return {
    ref: run(["rev-parse", "--abbrev-ref", "HEAD"]) || "unknown",
    sha: run(["rev-parse", "--short", "HEAD"]) || "unknown",
    day: run(["log", "-1", "--format=%cd", "--date=short"]) || "",
  };
}

function printList(label, names) {
  const shown = names.slice(0, MAX_LISTED);
  console.error(`  ${label} (${names.length}): ${shown.join(", ")}${names.length > MAX_LISTED ? `, … +${names.length - MAX_LISTED} more` : ""}`);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { classes, files } = builtClasses(opts.dist);
  if (classes.length < MIN_PLAUSIBLE_CLASSES) {
    console.error(
      `stylesheet class guard: only ${classes.length} classes found in ${files.map((f) => path.basename(f)).join(", ")} —\n` +
        "the extractor is probably confused by a new CSS shape, not the app being small. Refusing to\n" +
        `compare against a snapshot below ${MIN_PLAUSIBLE_CLASSES} classes.`,
    );
    process.exit(1);
  }

  if (opts.write) {
    const git = gitInfo();
    const header = [
      "# Stylesheet class snapshot — the class set the last release shipped.",
      "#",
      "# A diff here means the built CSS gained or lost classes. If that is the",
      "# styling change you are making, keep this file in the same commit.",
      "# If it is not, something is being scanned that nobody wrote: check the",
      "# @source roots in src/client/styles.css (they must stay src/ and",
      "# index.html) and look for stray files inside src/.",
      "#",
      `# source: ${git.ref} @ ${git.sha}${git.day ? ` (${git.day})` : ""}`,
      opts.note ? `# note: ${opts.note}` : null,
      `# classes: ${classes.length}`,
      "",
    ].filter((l) => l !== null);
    fs.mkdirSync(path.dirname(path.resolve(opts.file)), { recursive: true });
    fs.writeFileSync(opts.file, `${header.join("\n")}${classes.join("\n")}\n`);
    console.log(`stylesheet class guard: wrote ${classes.length} classes to ${opts.file}`);
    return;
  }

  if (!fs.existsSync(opts.file)) {
    console.error(
      `stylesheet class guard: ${opts.file} is missing — the guard cannot detect a\n` +
        "stylesheet change without it. Create it from a build of the last release:\n" +
        "  pnpm run build && pnpm run styles:write",
    );
    process.exit(1);
  }

  const snapshot = readSnapshot(opts.file);
  const added = classes.filter((c) => !snapshot.has(c));
  const removed = [...snapshot].filter((c) => !classes.includes(c)).sort();
  if (added.length === 0 && removed.length === 0) {
    console.log(`stylesheet class guard: OK (${classes.length} classes, unchanged from ${opts.file})`);
    return;
  }

  console.error(`\nstylesheet class guard: the built stylesheet changed (${added.length} added, ${removed.length} removed)\n`);
  if (removed.length) printList("✗ removed", removed);
  if (added.length) printList("✗ added", added);
  console.error(
    "\nIf the styling change is intentional, refresh the snapshot and commit it with the change:\n" +
      "  pnpm run styles:write\n" +
      "\nIf it is not, the class scan reached files nobody wrote. Check the @source roots in\n" +
      "src/client/styles.css (they must stay src/ and index.html) and look for stray files\n" +
      "inside src/ — an extracted package tree, a scratch page, a compiled .js next to its .tsx.",
  );
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
