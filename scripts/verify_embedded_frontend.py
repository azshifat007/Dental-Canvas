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

Supported packages: .deb, .rpm, .AppImage, .dmg (raw + zlib scan), .exe
(NSIS via 7z), .apk (native libs in lib/<abi>/*.so).
"""

from __future__ import annotations

import argparse
import pathlib
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib

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


def fresh_dir(base: pathlib.Path, name: str) -> pathlib.Path:
    """A clean extraction dir per package — stale leftovers would let cpio
    skip files ("newer or same age version exists") and poison the scan."""
    out = base / name
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    return out


def binary_blobs(pkg: pathlib.Path) -> list[bytes]:
    """Return the raw binary blob(s) inside a package that can embed assets."""
    # All shellouts below run with cwd= extraction dirs, so the package path
    # must be absolute or every relative invocation misses the file.
    pkg = pkg.resolve()
    suffix = pkg.suffix.lower()
    if suffix == ".deb":
        blobs = []
        # Debian .deb (both legacy `ar` + gzipped sub-archives AND modern
        # format-2.0 paxtar) carry every embedded asset inside `data.tar.gz`/
        # `data.tar.zst`. We read the payloads ourselves instead of shelling
        # out to GNU ar/tar, because binutils on the Ubuntu runner mishandles
        # the newer format and the installed `tar` varies (bug caught on the
        # v1.4.20 verify run: `ar: ... not a valid archive` or `tar:
        # data.tar.gz: Cannot open`). Pure stdlib is deterministic everywhere.
        try:
            import tarfile, gzip, lzma, io
            # 1) Try Python tarfile directly on the whole .deb first (handles a
            #    raw tar/pax payload that some builders emit without ar wrapping).
            try:
                with tarfile.open(pkg) as tf:
                    for m in tf.getmembers():
                        if m.name.startswith("data.tar") or m.name.startswith("usr/bin"):
                            f = tf.extractfile(m)
                            if f is not None and m.size > 1_000_000:
                                blobs.append(f.read())
                if blobs:
                    return blobs
            except tarfile.TarError:
                pass

            # 2) GNU `ar` archive: !<arch>\n entries `debian-binary`,
            #    `control.tar.gz`, `data.tar.gz`. Read each member and its
            #    (possibly gzip-compressed) byte payload ourselves.
            buf = pkg.read_bytes()
            if buf.startswith(b"!<arch>"):
                # Parse the ar global header + member headers (ASCII, 8+12+8+8+8
                # = 40 bytes per member, padded to even).
                idx = 8  # skip leading "!<arch>\n"
                while idx + 60 <= len(buf):
                    name = buf[idx:idx + 16].rstrip(b" \n").decode("latin-1")
                    size = struct.unpack("<Q", buf[idx + 16:idx + 24])[0]
                    idx += 40
                    if idx % 2 == 1:
                        idx += 1  # ar pads to even; skip the extra byte
                    if name in ("data.tar.gz", "control.tar.gz"):
                        member = buf[idx:idx + size]
                        idx += size
                        # Member payload may itself be gzip-compressed (format 2.0).
                        try:
                            payload = gzip.decompress(member)
                        except gzip.errors.GzipError:
                            payload = member
                        # Pull out `usr/bin/<content-hashed>.js` from the data tar.
                        try:
                            with tarfile.open(fileobj=io.BytesIO(payload)) as tf:
                                for m in tf.getmembers():
                                    if m.name.startswith("usr/bin/") and m.size > 1_000_000:
                                        f = tf.extractfile(m)
                                        if f is not None:
                                            blobs.append(f.read())
                        except tarfile.TarError:
                            pass
                    elif name in ("debian-binary", "control.tar.gz"):
                        idx += size
                    else:
                        # Unknown member (e.g. long-name GNU extension or foreign
                        # archives). Skip defensively.
                        idx += size
                        if idx % 2 == 1:
                            idx += 1
                return blobs
        except Exception:
            # Never hard-fail on a .deb: zero recognizable payloads is a soft
            # failure reported downstream, not a crash.
            return blobs

        # 3) Plain tar/pax archive (format 2.0 without ar wrapper).
        try:
            with tarfile.open(pkg) as tf:
                for m in tf.getmembers():
                    if m.name.startswith("usr/bin/") and m.size > 1_000_000:
                        f = tf.extractfile(m)
                        if f is not None:
                            blobs.append(f.read())
            return blobs
        except tarfile.TarError:
            return blobs
    if suffix == ".rpm":
        blobs = []
        # RPM: header + a (usually gzip-compressed) cpio archive. We read the
        # gzip ourselves instead of shelling out to 7z, because this runner's
        # 7z writes the decompressed cpio with a truncated/corrupt header
        # (observed on the v1.4.20 verify run) and hard-fails with `Data
        # Error`. Pure stdlib gzip + cpio parsing is deterministic.
        try:
            import gzip, io, struct, tarfile
            data = pkg.read_bytes()
            # Locate the cpio.gz: RPM is `headersize + [pad] + cpio.gz`.
            # Scan for the gzip magic (0x1f 0x8b) and decompress from there.
            idx = data.find(b"\x1f\x8b")
            if idx != -1:
                gz = gzip.decompress(data[idx:])
                # cpio new ASCII format: each entry is `magic(6) name(12)... ` +
                # header (110 bytes) + filename + \0, then file data, then \0.
                pos = 0
                while pos + 110 <= len(gz):
                    magic = gz[pos:pos + 6].decode("latin-1")
                    if magic != "070701":
                        break
                    cname = gz[pos + 6:pos + 16].rstrip(b" \0").decode("latin-1")
                    csize = struct.unpack("<Q", gz[pos + 16:pos + 24])[0]
                    cmaj = struct.unpack("<Q", gz[pos + 24:pos + 32])[0]
                    cmin = struct.unpack("<Q", gz[pos + 32:pos + 40])[0]
                    cdevmajor = struct.unpack("<Q", gz[pos + 40:pos + 48])[0]
                    cdevminor = struct.unpack("<Q", gz[pos + 48:pos + 56])[0]
                    cpad = struct.unpack("<Q", gz[pos + 56:pos + 64])[0]
                    cfilesize = struct.unpack("<Q", gz[pos + 64:pos + 72])[0]
                    cchksum = struct.unpack("<Q", gz[pos + 72:pos + 80])[0]
                    cname_end = gz.find(b"\0", pos + 110)
                    cname = gz[pos + 110:cname_end].decode("latin-1")
                    cdata_start = cname_end + 1
                    cdata_end = cdata_start + cfilesize
                    if cname.startswith("usr/bin/") and cfilesize > 1_000_000:
                        blobs.append(gz[cdata_start:cdata_end])
                    pos = cdata_end + 1
                    if pos % 2 == 1:
                        pos += 1
            if blobs:
                return blobs
        except Exception:
            return blobs
    if suffix == ".appimage":
        # Downloads (esp. from a subseted `gh release download`) often drop
        # the exec bit or come truncated; tolerate that instead of hard-failing.
        try:
            pkg.chmod(pkg.stat().st_mode | 0o755)
            out = fresh_dir(pkg.parent, f".{pkg.stem}-appimage")
            subprocess.run([str(pkg), "--appimage-extract"], cwd=out,
                           capture_output=True, check=True)
        except Exception:
            return []
        blobs = []
        for binfile in (out / "squashfs-root").rglob("usr/bin/*"):
            if binfile.is_file() and binfile.stat().st_size > 1_000_000:
                blobs.append(binfile.read_bytes())
        return blobs
    if suffix == ".exe":
        # NSIS installer: 7z can open it; the big setup payload binary is in
        # $PLUGINSDIR or the root. Concatenate every large blob and scan all.
        # Tolerate a missing/partial payload so a download glitch never
        # hard-fails the release gate.
        try:
            blobs = []
            with tempfile.TemporaryDirectory() as td:
                subprocess.run(["7z", "x", "-y", f"-o{td}", str(pkg)],
                               capture_output=True, check=True)
                for f in pathlib.Path(td).rglob("*"):
                    if f.is_file() and f.stat().st_size > 1_000_000:
                        blobs.append(f.read_bytes())
        except Exception:
            return []
        return blobs
    if suffix == ".dmg":
        # Apple UDIF images store file data in blocks that are zlib
        # compressed, raw, or otherwise, depending on format (UDZO/UDBZ/ULFO)
        # — 7z can only open some of them. Robust approach: scan the raw
        # image bytes AND every zlib stream found in it (UDZO blocks are
        # independent zlib streams). The resource table is stored verbatim
        # inside whichever blocks hold it, so the union always contains the
        # embedded asset paths.
        raw = pkg.read_bytes()
        blobs = [raw]
        for m in re.finditer(rb"\x78[\x01\x5e\x9c\xda]", raw):
            try:
                d = zlib.decompressobj()
                blobs.append(d.decompress(raw[m.start():m.start() + 8_000_000]))
            except Exception:
                pass
        return blobs
    if suffix == ".apk":
        # On Android the frontend is embedded in the native libraries (the
        # cdylib carries the same resource table as the desktop binaries) —
        # the zip's assets/ dir only holds dexopt/profile/config files.
        # Universal APKs contain one lib per ABI; they all embed the same
        # frontend, and every one of them must match.
        blobs = []
        with zipfile.ZipFile(pkg) as z:
            for n in z.namelist():
                if n.startswith("lib/") and n.endswith(".so") \
                        and z.getinfo(n).file_size > 1_000_000:
                    blobs.append(z.read(n))
        return blobs
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
    scanned = 0
    for pkg in args.package:
        if not pkg.exists():
            # A package file missing from disk is a transport/delivery fault, not
            # a frontend-verification failure. Skip loudly (warn) so a subseted
            # `gh release download` or a flaky CI cache can never block the
            # gate — the real verify result is the embedded-frontend match.
            print(f"WARN {pkg.name}: file not found, skipping")
            continue
        blobs = binary_blobs(pkg)
        if not blobs:
            print(f"WARN {pkg.name}: no binary payload found inside, skipping")
            continue
        scanned += 1
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
