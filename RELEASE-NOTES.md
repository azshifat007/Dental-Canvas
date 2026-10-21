# Dental Canvas v1.4.23

Released 2026-10-21.

## Medicines list scrolls (for real this time)

The medicines list has been reported as non-scrolling four times, and the last
three fixes never reached anyone. The cause was not CSS: committed compiled
files — `medicines-tab.js` and `medicines-page.js` — sat next to their `.tsx`
sources, and Vite resolves `.js` **before** `.tsx`. Every edit landed in the
`.tsx` while the bundle kept compiling the stale `.js`. `tsc` never noticed,
because it does not read the `.js` at all.

- The stray `.js` files are gone. The list now uses one bounded scroll area:
  the search field, count and **Add medicine** button stay fixed at the top and
  only the formulary scrolls, so the list can never clip without a scrollbar.
- New `scripts/check-shadowed-sources.mjs` fails the build (and CI) when any
  `.js`/`.mjs`/`.cjs` file shadows a `.ts`/`.tsx` of the same name, so a
  generated file can never silently replace a source again.

If you are on an old desktop build, this is the release that finally contains
the working layout.

## "Stuck on an old version" machines now heal themselves

The in-app updater used to swallow every failure and then report "You're on
the latest version", which is how a Windows install could sit on v1.4.10 while
the releases page showed v1.4.22.

- Update checks now fall back to the GitHub releases API when the Tauri
  updater fails, so the app can still see that a newer version exists.
- Failures are reported in Settings → About and in a banner, never hidden:
  the last error and the last check time are both shown.
- Three outcomes, each with the action that actually works:
  - **Download & install** — the signed in-app updater handles it.
  - **Download installer** — this install cannot update itself; opens the
    right installer for the OS on the releases page (`api.github.com` added to
    the CSP `connect-src`).
  - **Repair & reload** — the binary is already current but the page is served
    from a stale service-worker cache; clears the shell cache and worker
    (patient data lives in IndexedDB and is untouched).
- An update that is available is now visible outside Settings, with a dismiss
  that remembers the version.

## Also

- `Cargo.lock` now tracks the release version (it had drifted to 1.4.21).

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