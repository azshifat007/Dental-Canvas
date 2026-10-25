# Reproducible builds

Two builds of the same commit should produce the same bytes — on a developer
laptop and on a CI runner. This page explains what is guaranteed, how to check
it, and where the guarantees stop.

## What is guaranteed

| Artifact | Reproducible? | Notes |
|---|---|---|
| `dist/` (the whole frontend, `index.html`, `sw.js`, hashed JS/CSS, `sql-wasm.wasm`) | **Yes** — byte-identical across Linux, macOS and Windows | This is the payload embedded in every package |
| `repro-manifest.json` / `rootHash` | **Yes** | Same value on every machine |
| Rust binary (same OS, same rustc, same `RUSTFLAGS`) | Practically yes | Path remapping + stripped symbols remove the usual drift |
| `.deb` / `.rpm` / `.AppImage` / `.dmg` / `.exe` / `.apk` | **No** | See [Limits](#limits) |

The frontend is the part that matters in practice: every installer embeds
`dist/`, and `scripts/verify_embedded_frontend.py` already refuses to publish a
package whose embedded asset hashes differ from a fresh CI build of the tag. So
"`dist/` is reproducible" is what makes a local build comparable with a shipped
one.

## Checking it locally

```bash
npm run repro
```

This builds `dist/` twice, into `.repro/a` and `.repro/b` (separate output
directories, same commit, same toolchain), hashes every file and fails on a
single differing byte:

```
reproducible build check (SOURCE_DATE_EPOCH=1792604464)
  [1/2] vite build → .repro/a
  [1/2] vite build --mode sw → .repro/a
  [2/2] vite build → .repro/b
  [2/2] vite build --mode sw → .repro/b

✓ two independent builds are byte-identical (31 files, 25.4s)
  rootHash 8ac4567a75590fd7592f8bd675b64840bd921f895bc3d13cbd908800128bb2c7
  manifest .repro/manifest.json
  checks   .repro/SHA256SUMS
```

`--keep` retains both trees so the differing files can be inspected.
`.repro/` is gitignored.

Run it on a clean checkout when you intend to compare the result with a
release. Tailwind's content sources are pinned to `src/` and `index.html` in
`src/client/styles.css` (`source(none)` plus explicit `@source`), so a package
extracted in the repo root for inspection — a `.deb`'s `usr/` tree, an AppImage's
`squashfs-root/`, a scratch HTML page — cannot change the CSS or the hash. A new
untracked file *inside* those roots still can, and the script warns about it.

## Comparing with a release

Each release publishes two extra assets:

- `repro-manifest.json` — the manifest of the frontend that CI verified inside
  every package (file list + SHA-256 + `rootHash`), plus the tool versions used.
- `SHA256SUMS` — checksums of the release assets themselves.

To confirm your local build is the same software CI shipped:

```bash
npm run repro
node -e 'console.log(require("./.repro/manifest.json").rootHash)'
curl -sL https://github.com/azshifat007/Dental-Canvas/releases/latest/download/repro-manifest.json \
  | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).rootHash))'
```

Equal `rootHash` values mean the frontend bytes are identical. If they differ,
compare the two files directly:

```bash
node scripts/build-manifest.mjs --compare .repro/manifest.json path/to/repro-manifest.json
```

which lists changed, added and removed files, and flags a manifest whose stored
`rootHash` does not match its own file list.

`rootHash` is the SHA-256 of a `SHA256SUMS`-style listing, so it can also be
reproduced by hand from inside the build directory:

```bash
cd dist && find . -type f | sort | xargs sha256sum | sha256sum
```

## What makes it reproducible

- `scripts/repro-env.sh` pins the environment before any package build:
  `SOURCE_DATE_EPOCH` (the commit time, not the runner clock), `TZ=UTC`,
  `LC_ALL=C`/`LANG=C`, `CARGO_INCREMENTAL=0`, and `RUSTFLAGS` remapping the
  checkout and the cargo registry to fixed paths
  (`/build/dental-canvas`, `/cargo`) so panic locations and debug info stop
  carrying `/home/<user>/...`.
- `.gitattributes` forces LF everywhere. A CRLF checkout on Windows changes the
  input bytes and therefore every content hash — this is the v1.4.11 incident.
- `vite.config.ts` sorts the service-worker precache manifest. `readdirSync`
  returns entries in filesystem order, so an unsorted manifest made `sw.js`
  differ between ext4, APFS and NTFS.
- `[profile.release]` in `src-tauri/Cargo.toml` sets `codegen-units = 1` and
  `incremental = false` (incremental caches embed timestamps, and parallel
  codegen units let two builds of one commit lay code out differently).
- The output contains no clock, hostname, username or absolute path: nothing in
  the bundle is stamped with "now". `scripts/repro-build.mjs` fails if the two
  runs disagree, and the CI gate below catches a reintroduction on every push.

## CI gates

`.github/workflows/ci.yml` runs, on every push and pull request:

1. `reproducible-frontend` (ubuntu + windows) — builds twice and fails unless
   the two runs are byte-identical.
2. `reproducible-cross-os` — compares the Windows and Linux manifests and fails
   unless they are byte-identical to each other.

Release builds (`build-packages.yml`, triggered by a `v*` tag) run the same
pinned environment in all four packaging jobs, and the verify job records the
manifest of the reference frontend it checked the packages against.

## Limits

Byte-identical **installers** are out of reach, and that is expected:

- **Signing.** The updater bundle is minisign-signed, the APK is signed with the
  release keystore, and macOS is ad-hoc signed. Signatures are applied last and
  depend on the payload, so any packaging difference shows up here.
- **Packaging tools stamp time and identity.** `.deb`/`.rpm` honour
  `SOURCE_DATE_EPOCH` where the tool supports it (dpkg-deb ≥ 1.19, rpm ≥ 4.14);
  NSIS, AppImage and DMG write their own timestamps and owner metadata.
- **Toolchains drift.** A different rustc, NDK, WebKitGTK or makensis version
  produces a different binary. Two builds must use the same versions — the
  manifest records the ones actually used (`build.node`, `build.vite`,
  `build.rustc`) so a mismatch is explainable rather than mysterious.
- **Cross-OS binaries are never comparable.** The `.exe` and the `.deb` contain
  different code; only the embedded frontend is shared, and that is exactly what
  is verified and published as a manifest.
