# Dental Canvas — Release Process

How to ship a new Windows installer version.

## Version bump (3 files)

1. `package.json` — `"version"`
2. `src-tauri/Cargo.toml` — `version = "x.y.z"`
3. `src-tauri/Cargo.lock` — the `dental-canvas` package's `version` line (~line 550)

`src-tauri/tauri.conf.json` inherits from package.json automatically.

## Pre-flight checks

```bash
npx tsc --noEmit   # typecheck
npx vitest run     # tests (219 as of v1.4.2)
npm run build      # builds app + sw.js with precache manifest
```

## Ship

```bash
git add <specific files>          # never git add -A
git commit -m "..."
git tag vX.Y.Z
git push origin main && git push origin vX.Y.Z
```

The `v*` tag triggers **Build Windows installer** (`.github/workflows/build-windows.yml`). CI enforces that the tag matches `package.json` and `Cargo.toml` versions.

Note: if you add Rust dependencies (`src-tauri/Cargo.toml`), don't commit Cargo.lock changes generated locally unless you can run cargo — the CI runner resolves the lock as needed (tauri-action builds without `--locked`).

## After CI (green, ~14 min)

1. Verify the asset: `gh release view vX.Y.Z --json assets`
2. **Replace the auto-generated release notes** — `gh release edit vX.Y.Z --notes ...`. Historically these were the wrong "UI shell only" template; the workflow's `releaseBody` now contains correct offline notes, but check anyway and enrich with feature bullets.

## Known good patterns (Windows/Tauri runtime)

- Never use `window.open()` for anything — it silently does nothing in the Tauri WebView. Use `openExternalUrl()` from `src/client/lib/open-external.ts` (routes through tauri-plugin-opener).
- Never print via `window.open("", "_blank")` + `document.write` — use `printHtmlDocument()` / `printSheetHtml()` from `src/client/lib/print.ts` (hidden iframe).
- Single-instance is enforced by tauri-plugin-single-instance; don't remove it (protects the shared IndexedDB from concurrent writers).
- New DB tables must be added BOTH to `src/server/schema.sql` (fresh installs) AND as `CREATE TABLE IF NOT EXISTS` in `ensureColumnMigrations()` in `src/server/index.ts` (existing installs).
- New tables must also be added to the top (children first) of the drop-order list in `resetDb()` in `tests/helpers.ts`, or tests fail with FK errors on the second test.
