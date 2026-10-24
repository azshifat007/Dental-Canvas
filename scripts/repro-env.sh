#!/usr/bin/env bash
# Pin the environment of a release build so artifacts are reproducible.
#
# Source it (not execute it) in the shell that runs the build:
#
#   source scripts/repro-env.sh        # locally
#   - run: source scripts/repro-env.sh # in CI, before the build step
#
# Inside GitHub Actions it also appends every variable to $GITHUB_ENV, because
# `export` alone does not survive into the next workflow step.
#
# What it pins:
#   SOURCE_DATE_EPOCH  commit time instead of "now" — dpkg-deb, rpm and NSIS
#                      stamp archives from this instead of the wall clock.
#   TZ / LC_ALL / LANG build tools must not pick up the runner's timezone or
#                      locale when sorting files or formatting dates.
#   RUSTFLAGS          remaps the build directory and the cargo registry to
#                      fixed paths, so panic locations and debug info no longer
#                      contain /home/<user>/... (the main source of
#                      machine-dependent Rust binaries).
#   CARGO_INCREMENTAL  incremental caches bake in timestamps; off for releases.
#   CARGO_NET_OFFLINE  optional: set to 1 to fail instead of resolving new
#                      versions when the lockfile says otherwise.
#
# Nothing here changes what the app does — only how its inputs are stamped.

set -euo pipefail

root=$(pwd -W 2>/dev/null || pwd)
cargo_home=${CARGO_HOME:-$HOME/.cargo}

epoch=${SOURCE_DATE_EPOCH:-}
if [ -z "$epoch" ]; then
  epoch=$(git log -1 --format=%ct 2>/dev/null || true)
fi
if ! printf '%s' "$epoch" | grep -Eq '^[0-9]+$'; then
  echo "repro-env: no git history and no SOURCE_DATE_EPOCH — using the fixed epoch 0" >&2
  epoch=0
fi

rustflags="--remap-path-prefix=$root=/build/dental-canvas --remap-path-prefix=$cargo_home=/cargo"
# On Windows (Git Bash) cargo hands rustc backslash paths, so remap both forms.
if command -v cygpath >/dev/null 2>&1; then
  rustflags="$rustflags --remap-path-prefix=$(cygpath -w "$root")=C:\\build\\dental-canvas"
fi

export TZ=UTC
export LC_ALL=C
export LANG=C
export SOURCE_DATE_EPOCH="$epoch"
export CARGO_INCREMENTAL=0
export RUSTFLAGS="${RUSTFLAGS:-} $rustflags"

if [ -n "${GITHUB_ENV:-}" ]; then
  # Multiline-safe: values here are single-line, so plain KEY=VALUE is correct.
  {
    echo "TZ=UTC"
    echo "LC_ALL=C"
    echo "LANG=C"
    echo "SOURCE_DATE_EPOCH=$epoch"
    echo "CARGO_INCREMENTAL=0"
    echo "RUSTFLAGS=$RUSTFLAGS"
    echo "REPRO_RUSTFLAGS=$rustflags"
  } >>"$GITHUB_ENV"
fi

echo "repro-env: SOURCE_DATE_EPOCH=$epoch (UTC $(date -u -d "@$epoch" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo unknown))"
echo "repro-env: remapping $root -> /build/dental-canvas"
