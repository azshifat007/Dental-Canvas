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
npx vitest run     # tests
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

## v1.4.20 (in progress)

1. Bump version in `package.json`, `src-tauri/Cargo.toml`, and the `dental-canvas`
   entry in `src-tauri/Cargo.lock` → `1.4.20`.
2. Commit, tag `v1.4.20`, push, and let CI build the six packages (Windows NSIS
   installer, Linux deb/rpm/AppImage, macOS DMG, Android APK).
3. Poll the build run via `gh api repos/azshifat007/Dental-Canvas/actions/runs/<id>/jobs`
   until all six jobs report `success`.
4. Write release notes:

   - **What's new page** — new `Admin → What's new` history page; lists recent
     versions + changelogs fetched from the public GitHub releases API, cached
     in `localStorage` (24 h TTL) and shown offline ("Offline copy" chip); also
     linked from the post-update banner and Settings → About.
   - **Scroll-audit fixes** — setup-wizard card and sidebar nav scroll containers
     no longer rely on a flexible ancestor chain, so the medicine list / wizard /
     sidebar scroll no longer clips on Windows 11.
   - **Scroll-layout guard** — `scripts/check-scroll-layout.mjs` now runs in
     `npm run build` and on pre-commit: it rejects overflow-hidden wrappers that
     are not `relative`/flex/grid and contain an unbounded scroll area, and
     overflow-hidden children of `fixed` overlays without a height bound.
   - Carry forward the v1.4.19 bulletproof scroll + post-update banner work.

   Commit the notes with `gh release edit v1.4.20 --title "Dental Canvas v1.4.20"
   --notes "$(cat RELEASE-NOTES.md)"` after the tag is pushed.

5. Verify-and-publish: the embedded-frontend hash check and `latest.json` feed
   cross-check run automatically in CI.
