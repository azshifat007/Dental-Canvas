#!/usr/bin/env python3
"""
Verify that packaged binaries embed the frontend produced by the current build.

This is the automated version of the v1.4.4 stale-UI post-mortem: a package
can be built from a different frontend than the one in the repo (stale CI
cache, manual artifact mix-up), and the only way to catch it is to open the
package and compare. Tauri stores every embedded asset's path in a plaintext
resource table inside the binary, so matching the *content-hashed* names that
Vite generates (e.g. index-DxKk3lpA.js) is sufficient proof that the exact
same file bytes were compiled in — no decompression of the asset bodies needed.

Usage:
  verify_embedded_frontend.py --dist ./dist --package foo.deb [--package bar.dmg ...]

Supported packages: .deb, .rpm, .AppImage, .dmg (7z), .exe (NSIS, 7z), .apk
(unzip; assets live under assets/ and are compared the same way).
"""

from __future__ import annotations

import argparse
import pathlib
import re
import subprocess
import sys
import tempfile
import zipfile

# Tauri's embedded-asset table is length-prefixed binary: the path appears
# verbatim (e.g. "/assets/index-C754DkWb.js") with no terminator byte after
# it, so the pattern must anchor on the assets/ prefix and stop at the first
# valid extension — the filename charset does the rest.
ASSET_HASH_RE = re.compile(r"assets/([A-Za-z0-9][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8}\.(?:js|mjs|css))")


def collect_expected(dist: pathlib.Path) -> set[str]:
    """Hashed asset filenames Vite emitted for this build."""
    names: set[str] = set()
    for pat in ("*.js", "*.mjs", "*.css"):
        for p in (dist / "assets").glob(pat):
            names.add(p.name)
    if not names:
        raise SystemExit(f"error: no hashed assets found in {dist}/assets — run the build first")
    return names


def binary_blobs(pkg: pathlib.Path) -> list[bytes]:
    """Return the raw binary blob(s) inside a package that can embed assets."""
    suffix = pkg.suffix.lower()
    if suffix == ".deb":
        blobs = []
        for member in ("data.tar.xz", "data.tar.gz", "data.tar.zst", "data.tar"):
            if (pkg.parent / member).exists():
                (pkg.parent / member).unlink()
        out = pkg.parent / f".{pkg.stem}-deb"
        out.mkdir(exist_ok=True)
        subprocess.run(["ar", "x", str(pkg)], cwd=out, check=True)
        tar = next(m for m in ("data.tar.xz", "data.tar.gz", "data.tar.zst", "data.tar")
                   if (out / m).exists())
        subprocess.run(["tar", "-xf", str(out / tar), "-C", str(out)], check=True)
        for binfile in out.rglob("usr/bin/*"):
            if binfile.is_file() and binfile.stat().st_size > 1_000_000:
                blobs.append(binfile.read_bytes())
        return blobs
    if suffix == ".rpm":
        out = pkg.parent / f".{pkg.stem}-rpm"
        out.mkdir(exist_ok=True)
        with open(pkg, "rb") as fh:
            subprocess.run(["rpm2cpio"], stdin=fh, stdout=subprocess.PIPE, check=True)
        with open(pkg, "rb") as fh:
            cpio = subprocess.run(["rpm2cpio"], stdin=fh, stdout=subprocess.PIPE, check=True).stdout
        subprocess.run(["cpio", "-idm", "--quiet"], input=cpio, cwd=out, check=True)
        for binfile in out.rglob("usr/bin/*"):
            if binfile.is_file() and binfile.stat().st_size > 1_000_000:
                return [binfile.read_bytes()]
        return []
    if suffix == ".appimage":
        pkg.chmod(pkg.stat().st_mode | 0o755)  # downloads often drop the exec bit
        out = pkg.parent / f".{pkg.stem}-appimage"
        out.mkdir(exist_ok=True)
        subprocess.run([str(pkg), "--appimage-extract"], cwd=out,
                       capture_output=True, check=True)
        blobs = []
        for binfile in (out / "squashfs-root").rglob("usr/bin/*"):
            if binfile.is_file() and binfile.stat().st_size > 1_000_000:
                blobs.append(binfile.read_bytes())
        return blobs
    if suffix == ".exe":
        # NSIS installer: 7z can open it; the big setup payload binary is in
        # $PLUGINSDIR or the root. Concatenate every large blob and scan all.
        blobs = []
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(["7z", "x", "-y", f"-o{td}", str(pkg)],
                           capture_output=True, check=True)
            for f in pathlib.Path(td).rglob("*"):
                if f.is_file() and f.stat().st_size > 1_000_000:
                    blobs.append(f.read_bytes())
        return blobs
    if suffix == ".dmg":
        blobs = []
        with tempfile.TemporaryDirectory() as td:
            subprocess.run(["7z", "x", "-y", f"-o{td}", str(pkg)],
                           capture_output=True, check=True)
            for f in pathlib.Path(td).rglob("*"):
                if f.is_file() and f.stat().st_size > 1_000_000:
                    blobs.append(f.read_bytes())
        return blobs
    if suffix == ".apk":
        with zipfile.ZipFile(pkg) as z:
            big = [n for n in z.namelist()
                   if n.startswith("assets/") and z.getinfo(n).file_size > 500_000]
            return [z.read(n) for n in big]
    raise SystemExit(f"error: don't know how to inspect {pkg}")


def embedded_hashes(blobs: list[bytes]) -> set[str]:
    """Hashed Vite asset filenames visible in the plaintext resource tables."""
    found: set[str] = set()
    for blob in blobs:
        for m in ASSET_HASH_RE.finditer(blob.decode("latin-1")):
            found.add(m.group(1).split("/")[-1].split("\\")[-1])
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dist", type=pathlib.Path, default=pathlib.Path("dist"))
    ap.add_argument("--package", action="append", required=True, type=pathlib.Path)
    args = ap.parse_args()

    expected = collect_expected(args.dist)
    failures = 0
    for pkg in args.package:
        if not pkg.exists():
            print(f"FAIL {pkg.name}: file not found")
            failures += 1
            continue
        blobs = binary_blobs(pkg)
        if not blobs:
            print(f"FAIL {pkg.name}: no binary payload found inside")
            failures += 1
            continue
        got = embedded_hashes(blobs)
        # The *entry* chunk referenced by index.html must be present; other
        # assets are informational (lazy chunks may legitimately be absent
        # from old formats, but the entry hash can never be).
        entry = entry_chunk_from_index(args.dist)
        missing = ({entry} - got) if entry else set()
        matched = sorted(got & expected)
        if missing:
            print(f"FAIL {pkg.name}: embedded frontend is NOT this build")
            print(f"  entry chunk {entry} not found in the package's resource table")
            print(f"  embedded (hashed) assets seen: {sorted(got)[:12]}{' …' if len(got) > 12 else ''}")
            failures += 1
        elif not matched:
            print(f"FAIL {pkg.name}: no recognizable embedded assets found")
            failures += 1
        else:
            print(f"OK   {pkg.name}: embedded frontend matches this build "
                  f"({len(matched)} asset hashes matched, entry {entry})")
    return 1 if failures else 0


def entry_chunk_from_index(dist: pathlib.Path) -> str | None:
    html = (dist / "index.html").read_text(encoding="utf-8", errors="replace")
    m = re.search(r'src="[^"]*?(index-[A-Za-z0-9_-]{8}\.js)"', html)
    return m.group(1) if m else None


if __name__ == "__main__":
    sys.exit(main())
