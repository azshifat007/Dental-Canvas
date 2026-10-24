#!/usr/bin/env node
/**
 * Reproducible build check for the frontend bundle.
 *
 * Builds `dist/` twice — same commit, same toolchain, two separate output
 * directories — and fails if a single byte differs. Every release package
 * (.exe/.deb/.rpm/.AppImage/.dmg/.apk) embeds this directory, so a stable
 * `rootHash` here is what makes a local build comparable with the artifact CI
 * shipped.
 *
 *   npm run repro                     # build twice, compare, write .repro/manifest.json
 *   npm run repro -- --keep           # keep both build trees for inspection
 *   npm run repro -- --baseline dist  # compare an existing build with a fresh one
 *                                     # (used by the release workflow, which has
 *                                     #  already built dist/ for verification)
 *
 * The environment is pinned the same way `scripts/repro-env.sh` pins it for the
 * packaging jobs: TZ=UTC, LC_ALL=C, SOURCE_DATE_EPOCH from the commit (not
 * "now"), colours disabled. Nothing in the bundle embeds the clock, and the
 * checks below keep it that way.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  computeManifest,
  diffManifests,
  checksumText,
  rootHashOf,
} from "./build-manifest.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const REPRO_DIR = path.join(REPO_ROOT, ".repro");
const VITE_BIN = path.join(REPO_ROOT, "node_modules/vite/bin/vite.js");

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function commitEpoch() {
  if (process.env.SOURCE_DATE_EPOCH) {
    if (!/^\d+$/.test(process.env.SOURCE_DATE_EPOCH)) {
      fail("SOURCE_DATE_EPOCH must be a Unix timestamp in seconds");
    }
    return process.env.SOURCE_DATE_EPOCH;
  }
  const r = spawnSync("git", ["log", "-1", "--format=%ct"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const value = r.status === 0 ? r.stdout.trim() : "";
  // A tarball checkout has no history; a fixed epoch is still deterministic.
  return /^\d+$/.test(value) ? value : "0";
}

/** Environment every build in this script runs with. */
function pinnedEnv(epoch) {
  return {
    ...process.env,
    TZ: "UTC",
    LC_ALL: "C",
    LANG: "C",
    FORCE_COLOR: "0",
    NO_COLOR: "1",
    SOURCE_DATE_EPOCH: epoch,
  };
}

/** Files git does not track — they exist locally but not in CI's checkout. */
function untrackedFiles() {
  const r = spawnSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (r.status !== 0) return [];
  return r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    env,
    stdio: "pipe",
    encoding: "utf8",
  });
  if (r.status !== 0) {
    process.stderr.write(r.stdout ?? "");
    process.stderr.write(r.stderr ?? "");
    fail(`${cmd} ${args.join(" ")} exited with ${r.status}`);
  }
  return r;
}

/** Vite app pass + service-worker pass, into `outDir` (relative to repo root). */
function buildOnce(outDir, env, label) {
  const rel = path.relative(REPO_ROOT, outDir).split(path.sep).join("/");
  rmSync(outDir, { recursive: true, force: true });
  console.log(`  [${label}] vite build → ${rel}`);
  run(process.execPath, [VITE_BIN, "build", "--outDir", rel], env);
  console.log(`  [${label}] vite build --mode sw → ${rel}`);
  run(process.execPath, [VITE_BIN, "build", "--mode", "sw", "--outDir", rel], env);
}

function main(argv) {
  const keep = argv.includes("--keep") || argv.includes("--no-cleanup");
  const baselineAt = argv.indexOf("--baseline");
  const baseline = baselineAt !== -1 ? argv[baselineAt + 1] : null;
  if (baselineAt !== -1 && !baseline) {
    fail("--baseline needs a build directory, e.g. --baseline dist");
  }
  const started = Date.now();

  if (!existsSync(VITE_BIN)) {
    fail("vite is not installed — run `pnpm install` first");
  }

  const epoch = commitEpoch();
  const env = pinnedEnv(epoch);
  console.log(`reproducible build check (SOURCE_DATE_EPOCH=${epoch})`);

  // Both runs see the same tree, so they still agree — but Tailwind scans the
  // working directory for class names, so an untracked file (an extracted .deb,
  // a scratch .html) changes the CSS hash and the build will not match CI's
  // clean checkout. Say so instead of leaving a mystery rootHash.
  const untracked = untrackedFiles();
  if (untracked.length > 0) {
    const sample = untracked.slice(0, 3).join(", ") + (untracked.length > 3 ? ", …" : "");
    console.warn(
      `note: ${untracked.length} untracked path(s) in this tree (${sample}).\n` +
        `      Tailwind scans them, so this rootHash will differ from CI for the same commit.\n` +
        `      Re-run from a clean checkout to compare with a release manifest.`,
    );
  }

  // Same pre-flight guards `npm run build` runs, so this cannot pass on a tree
  // whose normal build would fail.
  run(process.execPath, [path.join(HERE, "check-shadowed-sources.mjs")], env);
  run(process.execPath, [path.join(HERE, "check-scroll-layout.mjs")], env);

  mkdirSync(REPRO_DIR, { recursive: true });
  const aDir = path.join(REPRO_DIR, "a");
  const bDir = path.join(REPRO_DIR, "b");

  let a;
  if (baseline) {
    console.log(`  [1/2] using existing build → ${baseline}`);
    a = computeManifest(path.resolve(REPO_ROOT, baseline), { label: "baseline" });
  } else {
    buildOnce(aDir, env, "1/2");
    a = computeManifest(aDir, { label: "run-1" });
  }
  buildOnce(bDir, env, "2/2");

  const b = computeManifest(bDir, { label: "run-2" });
  const problems = diffManifests(a, b);

  if (problems.length > 0) {
    for (const p of problems) console.error(`  ${p}`);
    fail(
      "the frontend build is not reproducible — the two runs differ.\n" +
        "  Check for clock/path/filename-order inputs (see docs/reproducible-builds.md).",
    );
  }

  // Manifest of the committed artifact shape: same contents as dist/, labelled
  // with the platform so a CI matrix can compare across operating systems.
  const manifest = {
    ...a,
    build: {
      ...a.build,
      label: `${process.platform}-${process.arch}`,
      sourceDateEpoch: Number(epoch),
    },
  };
  writeFileSync(
    path.join(REPRO_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  writeFileSync(path.join(REPRO_DIR, "SHA256SUMS"), checksumText(a.files));

  // The two runs must agree on the aggregate too, not just per file.
  if (rootHashOf(a.files) !== rootHashOf(b.files)) {
    fail("root hashes disagree between the two runs");
  }

  console.log(
    `\n✓ the builds are byte-identical ` +
      `(${a.files.length} files, ${(Date.now() - started) / 1000}s)`,
  );
  console.log(`  rootHash ${manifest.rootHash}`);
  console.log(`  manifest .repro/manifest.json`);
  console.log(`  checks   .repro/SHA256SUMS`);

  if (!keep) rmSync(bDir, { recursive: true, force: true });
  else console.log(`  builds kept under .repro/`);
}

// Importing this module from a test must not build anything.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}
