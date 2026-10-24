#!/usr/bin/env node
/**
 * Byte-level manifest of a build output directory.
 *
 * Every release package embeds `dist/`, so if `dist/` is byte-identical then
 * the frontend inside every package is byte-identical too. This script turns a
 * build directory into a sorted, path-normalised list of SHA-256 digests plus
 * one `rootHash` that covers exactly the file bytes — no timestamps, owner
 * names, file modes or absolute paths — so a manifest produced on a Windows CI
 * runner can be compared with one produced on a developer's Linux box.
 *
 * Usage:
 *   node scripts/build-manifest.mjs dist                       # print summary
 *   node scripts/build-manifest.mjs dist --out manifest.json   # write JSON
 *   node scripts/build-manifest.mjs --compare a.json b.json    # diff, exits 1
 *
 * `rootHash` is the SHA-256 of the SHA256SUMS-style text it prints, so the same
 * value can be reproduced by hand from inside the build directory:
 *
 *   cd dist && find . -type f | sort | xargs sha256sum | sha256sum
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** Files under `dir`, as forward-slash relative paths sorted by name. */
export function listFiles(dir, rel = "") {
  const abs = rel ? path.join(dir, rel) : dir;
  const out = [];
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(dir, relPath));
    else if (entry.isFile()) out.push(relPath);
  }
  return out.sort();
}

/** The checksum text `rootHash` is computed over (identical to SHA256SUMS). */
export function checksumText(files) {
  return files.map((f) => `${f.sha256}  ./${f.path}\n`).join("");
}

export function rootHashOf(files) {
  return sha256(checksumText(files));
}

function jsonVersion(pkgPath) {
  try {
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? null;
  } catch {
    return null;
  }
}

function installedVersion(name, baseDir) {
  const pkg = installedPath(name, baseDir);
  return pkg ? jsonVersion(pkg) : null;
}

/** Absolute path to an installed package's package.json, or null. */
function installedPath(name, baseDir = REPO_ROOT) {
  try {
    const require = createRequire(path.join(baseDir, "package.json"));
    return require.resolve(`${name}/package.json`);
  } catch {
    const direct = path.join(baseDir, "node_modules", name, "package.json");
    return existsSync(direct) ? direct : null;
  }
}

function rustcVersion() {
  const r = spawnSync("rustc", ["-V"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function sourceEpoch() {
  const fromEnv = process.env.SOURCE_DATE_EPOCH;
  if (fromEnv && /^\d+$/.test(fromEnv)) return Number(fromEnv);
  const r = spawnSync("git", ["log", "-1", "--format=%ct"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const value = r.status === 0 ? Number.parseInt(r.stdout.trim(), 10) : NaN;
  return Number.isFinite(value) ? value : null;
}

/**
 * Build a manifest for `dir`.
 *
 * `files` + `rootHash` are the reproducible part (byte-identical across
 * machines). `build` is informational only: it explains *why* two manifests
 * disagree when they do (different Node, Rust, app version, ...).
 */
export function computeManifest(dir, { label = null } = {}) {
  const root = path.resolve(dir);
  if (!existsSync(root)) {
    throw new Error(`build directory not found: ${root}`);
  }
  const files = listFiles(root).map((relPath) => {
    const buf = readFileSync(path.join(root, relPath));
    return { path: relPath, size: buf.length, sha256: sha256(buf) };
  });
  if (files.length === 0) {
    throw new Error(`build directory is empty: ${root}`);
  }
  // Tool versions are informational — they explain a mismatch when one occurs.
  const vitePkg = installedPath("vite");
  const viteDir = vitePkg ? path.dirname(vitePkg) : null;
  return {
    schema: 1,
    app: {
      name: "dental-canvas",
      version: jsonVersion(path.join(REPO_ROOT, "package.json")),
    },
    build: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      vite: vitePkg ? jsonVersion(vitePkg) : null,
      // rollup is a transitive dependency of vite; resolve it from there.
      rollup: viteDir ? installedVersion("rollup", viteDir) : null,
      rustc: rustcVersion(),
      sourceDateEpoch: sourceEpoch(),
      label,
    },
    files,
    rootHash: rootHashOf(files),
  };
}

/** Compare two manifests; returns a human-readable diff (empty when equal). */
export function diffManifests(a, b) {
  const problems = [];
  const leftHash = rootHashOf(a.files ?? []);
  const rightHash = rootHashOf(b.files ?? []);
  // Recompute instead of trusting the stored value: a hand-edited or truncated
  // manifest must never report "identical".
  for (const [m, actual] of [
    [a, leftHash],
    [b, rightHash],
  ]) {
    if (m.rootHash && m.rootHash !== actual) {
      problems.push(
        `manifest rootHash does not match its own file list (${m.build?.label ?? "unknown"}): ` +
          `declared ${m.rootHash}, computed ${actual}`,
      );
    }
  }
  if ((a.files ?? []).length === 0 || (b.files ?? []).length === 0) {
    problems.push("one of the manifests lists no files — refusing to call that a match");
    return problems;
  }
  if (leftHash === rightHash) return problems;
  const index = (m) => new Map((m.files ?? []).map((f) => [f.path, f]));
  const left = index(a);
  const right = index(b);
  for (const [p, f] of left) {
    const other = right.get(p);
    if (!other) problems.push(`only in ${a.build?.label ?? "first"}:   ${p}`);
    else if (other.sha256 !== f.sha256) {
      problems.push(`content differs: ${p}\n    ${f.sha256}  ${f.size} bytes\n    ${other.sha256}  ${other.size} bytes`);
    }
  }
  for (const p of right.keys()) {
    if (!left.has(p)) problems.push(`only in ${b.build?.label ?? "second"}:  ${p}`);
  }
  if (problems.length === 0) {
    // Same files, different aggregate — can only be ordering/duplication.
    problems.push("file lists carry identical entries but the root hash differs");
  }
  return problems;
}

function readManifest(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function main(argv) {
  const args = [...argv];
  const compareAt = args.indexOf("--compare");
  if (compareAt !== -1) {
    const [aPath, bPath] = args.slice(compareAt + 1);
    if (!aPath || !bPath) {
      console.error("usage: build-manifest.mjs --compare <a.json> <b.json>");
      return 2;
    }
    const a = readManifest(aPath);
    const b = readManifest(bPath);
    const problems = diffManifests(a, b);
    if (problems.length > 0) {
      console.error(`manifests differ (${aPath} vs ${bPath}):`);
      for (const p of problems) console.error(`  ${p}`);
      return 1;
    }
    console.log(`identical builds: ${a.rootHash}`);
    console.log(
      `  ${a.files.length} files, node ${a.build?.node} on ${a.build?.platform}/${a.build?.arch}` +
        ` vs node ${b.build?.node} on ${b.build?.platform}/${b.build?.arch}`,
    );
    return 0;
  }

  const outAt = args.indexOf("--out");
  const labelAt = args.indexOf("--label");
  const positional = args.filter(
    (a, i) =>
      !a.startsWith("--") &&
      args[i - 1] !== "--out" &&
      args[i - 1] !== "--label",
  );
  const dir = positional[0];
  if (!dir) {
    console.error(
      "usage: build-manifest.mjs <build-dir> [--out <file>] [--label <name>]",
    );
    return 2;
  }
  const manifest = computeManifest(dir, {
    label: labelAt !== -1 ? (args[labelAt + 1] ?? null) : null,
  });
  if (outAt !== -1) {
    const out = args[outAt + 1];
    if (!out) {
      console.error("--out needs a file path");
      return 2;
    }
    writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  console.log(
    `${manifest.app.name} ${manifest.app.version}: ${manifest.files.length} files, ` +
      `node ${manifest.build.node}, ${manifest.build.platform}/${manifest.build.arch}`,
  );
  console.log(`rootHash ${manifest.rootHash}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`build-manifest: ${error.message}`);
    process.exitCode = 2;
  }
}
