# Inspecting a release package

How to look inside a shipped installer — a `.deb`, `.rpm`, `.AppImage`, `.exe`,
`.dmg` or `.apk` — without leaving anything behind in the repository.

**The rule: download and unpack under a temp directory, never in the checkout.**

## Why this is a rule and not a preference

On 2026-10-18 the v1.4.22 `.deb` was unpacked into the repository root to check
its binary. That left a 28 MB `usr/` tree behind:

```
usr/bin/dental-canvas                                    29,330,144 bytes
usr/share/applications/Dental Canvas.desktop                    196 bytes
usr/share/icons/hicolor/{32,128,256@2}x*/apps/dental-canvas.png  ~7 KB
```

Nobody noticed, and every local build after that silently disagreed with CI for
the same commit. Two reasons:

- Tailwind scans for class names in the working tree. Strings inside the
  extracted files reached the stylesheet, which changed `index-*.css`, its
  content hash, `sw.js`, and therefore the whole `rootHash` in
  `repro-manifest.json`.
- A `git add -A` would have committed a 29 MB binary and an icon set.

The scan is now pinned to `src/` and `index.html` (`source(none)` + explicit
`@source` in [src/client/styles.css](../src/client/styles.css)), so an extracted
tree can no longer change the CSS. That removes the *silent* failure; it does not
make extracting into the checkout a good idea.

## Download to a temp directory

`--pattern` is not optional: a bare `gh release download` fetches a subset of the
assets and will quietly miss the one you wanted.

```bash
tmp=$(mktemp -d)                       # /tmp/pkgcheck.AbC123
gh release download v1.4.23 --dir "$tmp" \
  --pattern '*.deb' --pattern '*.AppImage'
ls "$tmp"
```

## Unpack each format

Run every command with the working directory inside `$tmp`. Several of these
drop their output in the *current* directory, not next to the package.

| Format | Command | Result |
|---|---|---|
| `.deb` | `mkdir -p deb && cd deb && ar x ../Dental.Canvas_1.4.23_amd64.deb && tar xf data.tar.gz` | the packaged filesystem |
| `.deb` (no binutils) | `mkdir -p deb && cd deb && 7z x ../pkg.deb && 7z x data.tar` | same — 7z unpacks the ar wrapper only, so the inner `data.tar` needs a second pass |
| `.deb` (unusual) | if `ar x` rejects the file, it is a plain tar: `tar xf ../pkg.deb` | the packaged filesystem |
| `.rpm` | `mkdir -p rpm && cd rpm && rpm2cpio ../pkg.rpm \| cpio -idmu --verbose` | the packaged filesystem |
| `.AppImage` | `chmod +x pkg.AppImage && mkdir -p appimg && cd appimg && ../pkg.AppImage --appimage-extract` | `squashfs-root/` **in the current directory** |
| `.exe` (NSIS) | `7z x -o./exe Dental.Canvas_1.4.23_x64-setup.exe` | `dental-canvas.exe`, `uninstall.exe`, `$PLUGINSDIR/` |
| `.dmg` (macOS) | `hdiutil attach -nobrowse -mountpoint "$tmp/mnt" pkg.dmg`, then `hdiutil detach "$tmp/mnt"` | the mounted app bundle |
| `.apk` | `unzip -q app-universal-release.apk -d ./apk` | `classes.dex`, `lib/<abi>/libdental_canvas.so`, `assets/` |

A Linux install lands in the same shape the release notes describe — for the
desktop packages:

```
usr/bin/dental-canvas
usr/share/applications/Dental Canvas.desktop
```

On Android the frontend is not in `assets/` (that holds only `dexopt` and
`tauri.conf.json`); it is compiled into `lib/<abi>/libdental_canvas.so`, one per
ABI in the universal APK.

## Usually you do not need to unpack at all

[scripts/verify_embedded_frontend.py](../scripts/verify_embedded_frontend.py)
answers the question people actually have — *does this package contain the build
I just made?* — by scanning the embedded-asset table in place. `.deb`, `.rpm`,
`.dmg`, `.exe` and `.apk` need no directory at all (the `.exe` scratch space is a
system temp dir, never the checkout); only `.AppImage` extracts, into a
`.<name>-appimage` directory **next to the package** — still a reason to keep
packages in `$tmp`.

```bash
npm run build                      # dist/ for the commit you are checking
python3 scripts/verify_embedded_frontend.py --dist ./dist \
  --package "$tmp/Dental.Canvas_1.4.23_amd64.deb"
```

It prints one line per package, `OK ... embedded frontend matches this build`
or `FAIL ... NOT this build` with the asset hashes it saw, and exits non-zero if
any package fails.

A `FAIL` while comparing against an *older* tag is expected: `dist/` is built
from your working tree, so it only matches a package built from the same commit.
To compare properly, build the tag itself in its own worktree:

```bash
git worktree add "$tmp/tag" v1.4.23
cd "$tmp/tag" && pnpm install --frozen-lockfile && pnpm run build
cd - && python3 scripts/verify_embedded_frontend.py --dist "$tmp/tag/dist" \
  --package "$tmp/Dental.Canvas_1.4.23_amd64.deb"
git worktree remove "$tmp/tag"
```

The repo ships a `pnpm-lock.yaml` only, so use pnpm (CI pins 10.34.5) —
`npm ci` fails outright.

(`dist/` is byte-reproducible, so this works from any machine — see
[reproducible-builds.md](reproducible-builds.md).)

## Leaving no trace

```bash
rm -rf "$tmp"
git status --short --untracked-files=all     # must print nothing
```

Read that second line as the actual check: if anything extracted into the
checkout, `git status` names it.

`.gitignore` currently lists `/usr/`, `/squashfs-root/` and `/verify/` as a
safety net for the three common accidents. That is a net, not permission —
ignored files still sit on disk, still show up in `find`, and are one
`git add -f` away from being committed.

## If it already happened

```bash
git status --short --untracked-files=all     # what landed
file usr/bin/dental-canvas                   # confirm it is a package payload:
                                             # ELF 64-bit executable, not source
rm -rf usr                                   # or squashfs-root, verify, ...
npm run repro                                # rebuild, note rootHash
```

Compare that `rootHash` with `repro-manifest.json` from the release you were
inspecting (tags up to v1.4.23 predate the step that attaches it, so its absence
there means nothing). If they match, the stray tree never reached the build.

Faster than a hash comparison, `pnpm run lint:classes` names every class the
current build has that `scripts/stylesheet-classes.txt` does not — a stray tree
shows up there as a handful of utilities nobody wrote. To see the classes the
release you are inspecting actually shipped, compare against the
`stylesheet-classes.txt` asset on that release instead. If they
differ, rebuild from a clean checkout (`git clean -ndx` shows what would be
removed first) before concluding the build is broken.
