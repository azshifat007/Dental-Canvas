# Changelog

All notable changes to this project will be documented in this file.
See [Release process](docs/release-process.md) for how releases are cut.

## v1.4.20

- **What's new page** — new **Admin → What's new** history page listing recent
  versions and their changelogs fetched from the GitHub releases feed
  (`https://api.github.com/repos/azshifat007/Dental-Canvas/releases`), cached
  in `localStorage` (24 h TTL) and shown fully offline ("Offline copy" chip on
  stale data). Also reachable from the post-update banner and Settings → About.
- **Scroll-audit fixes** — setup wizard card and sidebar nav scroll containers
  no longer depend on a flexible ancestor chain, so the medicine list / wizard
  / sidebar scroll no longer clips on Windows 11.
- **Scroll-layout guard** — `scripts/check-scroll-layout.mjs` runs in `npm run
  build` and on pre-commit: it catches overflow-hidden wrappers that are not
  `relative`/flex/grid and contain an unbounded scroll area, and overflow-hidden
  children of `fixed` overlays without a height bound. Any new page JSX must
  comply, or the build fails.
- **Under the hood** — bumped desktop + desktop-shell versions to v1.4.20,
  wired the layout guard into the build and the versioned pre-commit hook
  (.githooks/pre-commit), and verified with the scroll-layout guard, `tsc
  --noEmit`, `vitest run` (266/266), `npm run build` + `sw.js` stamp
  (`dental-canvas-shell-v1-1.4.19`).

## v1.4.19

- Bulletproof medicine-list scrolling (always-visible slim scrollbar),
  post-update banner with changelog from the feed, and the auto-backup
  enhancement.
