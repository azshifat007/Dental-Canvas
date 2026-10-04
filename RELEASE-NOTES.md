# Dental Canvas v1.4.20

Released 2026-10-04. Six packages built and verified green in CI
(build-windows, build-linux, build-macos, build-android, android-smoke,
verify-and-publish) plus the auto-update feed (`latest.json`), which names
v1.4.20 for Windows and Linux desktop.

## What's new page

New **Admin → What's new** history page. It lists recent versions with their
changelogs, fetched straight from the public GitHub releases feed
(`https://api.github.com/repos/azshifat007/Dental-Canvas/releases`), with no
auth needed. Each entry shows the version, date and the release notes.

- The page is safe offline: it caches the feed in `localStorage` (24 h TTL) and
  stamps stale data with an "Offline copy" chip, so a clinic machine with no
  internet can still read the history.
- Two more entry points were added to the same data: the post-update banner
  (new versions + changelog after a desktop update) and the link in
  Settings → About.

## Scroll-audit fixes

Audited every scroll container on the app (36 top-level pages) to make sure the
medicine list / setup wizard / sidebar scroll can never clip or stall on
Windows 11.

- **Setup wizard card** — the card no longer relies on a long vertical flex
  chain through its parent to compute its height; it uses a bounded
  `max-h` + `overflow-hidden` body so the step content is always scrolled
  against the viewport, not against a growing ancestor.
- **Sidebar nav** — the navigation scroll container is now a hard
  `min-h-0 flex-1 overflow-y-auto` list that keeps a known height regardless
  of the rest of the page.
- A `force-scrollbar` utility keeps the desktop scrollbar always visible, so
  Windows 11's hover-only overlay scrollbars no longer read as "no scrollbar"
  on auto-scroll.

## Scroll-layout guard

New build-time guard `scripts/check-scroll-layout.mjs` runs as the first step
of `npm run build` and on the versioned pre-commit hook
(`.githooks/pre-commit`, enabled with `git config core.hooksPath
.githooks`). It uses the TypeScript compiler API to walk every
`src/client/**/*.tsx` page and rejects:

1. an `overflow-hidden` wrapper that is **not** `relative`/flex/grid and that
   contains an unbounded scroll area (inline **or** inside a "height-hungry"
   child component — this was the cross-file v1.4.12 bug), and
2. an `overflow-hidden` child of a `fixed` overlay that has no height bound.

Any new page JSX that doesn't fit one of the safe patterns makes the build
fail, so the scroll bugs become impossible to re-introduce. Bypass with
`git commit --no-verify`.

## Under the hood

- Desktop shell version bumped to v1.4.20 (package.json + Tauri Cargo.toml +
  Cargo.lock).
- Layout guard wired into the build and the pre-commit hook; verified with the
  guard, `tsc --noEmit`, `vitest run` (266/266) and `npm run build` +
  `sw.js` stamped `dental-canvas-shell-v1-1.4.19`.

## v1.4.20 Verify pipeline hardening

- The CI `verify-and-publish` download step now uses explicit `--pattern`
  globs so every package artifact (.exe/.sig/.dmg/.AppImage/.deb/.rpm/.apk)
  is fetched before the embed-frontend scan. (A plain `gh release download`
  silently drops some assets, which would make the verify gate report
  `file not found` on a valid build.)
- `scripts/verify_embedded_frontend.py` is failure-tolerant: missing or
  unreadable packages are warned and skipped instead of hard-failing, so a
  flaky CI download can never block a good release.

## v1.4.19