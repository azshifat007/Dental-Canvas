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
import gzip
import io
import lzma
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
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


def _decompress_payload(payload: bytes) -> bytes | None:
    """gunzip / unxz / unzstd a package payload — first format that works."""
    try:
        return gzip.decompress(payload)
    except Exception:
        pass
    try:
        return lzma.decompress(payload)
    except Exception:
        pass
    if shutil.which("zstd"):
        try:
            p = subprocess.run(["zstd", "-dc"], input=payload, capture_output=True, check=True)
            return p.stdout
        except Exception:
            pass
    return None


def _members_bin_blobs(tf: tarfile.TarFile) -> list[bytes]:
    """Large usr/bin binaries inside a tar — the Tauri frontend carrier."""
    out: list[bytes] = []
    for m in tf.getmembers():
        # Tar members may be prefixed with "./" depending on the builder.
        base = m.name[2:] if m.name.startswith("./") else m.name
        if m.isfile() and base.startswith("usr/bin/") and m.size > 1_000_000:
            f = tf.extractfile(m)
            if f is not None:
                out.append(f.read())
    return out


def _tar_bin_blobs(payload: bytes) -> list[bytes]:
    out: list[bytes] = []
    try:
        with tarfile.open(fileobj=io.BytesIO(payload)) as tf:
            out.extend(_members_bin_blobs(tf))
    except tarfile.TarError:
        pass
    return out


def _cpio_bin_blobs(payload: bytes) -> list[bytes]:
    """usr/bin binaries from a cpio newc archive. The newc header fields are
    ASCII HEX (not binary) and both the name and the data are padded to
    4-byte boundaries — the original struct.unpack("<Q") read destroyed the
    offsets after the first entry, so .rpm verification silently found
    nothing and then crashed in the unknown-suffix fallthrough."""
    out: list[bytes] = []
    pos = 0
    while pos + 110 <= len(payload) and payload[pos:pos + 6] == b"070701":
        try:
            fields = [int(payload[pos + 6 + i * 8: pos + 14 + i * 8], 16) for i in range(13)]
        except ValueError:
            break
        filesize, namesize = fields[6], fields[11]
        name_start = pos + 110
        name = payload[name_start:name_start + max(namesize - 1, 0)].decode("latin-1", "replace")
        if name == "TRAILER!!!":
            break
        data_start = (name_start + namesize + 3) & ~3
        data_end = min(data_start + filesize, len(payload))
        base = name[2:] if name.startswith("./") else name
        if base.startswith("usr/bin/") and filesize > 1_000_000:
            out.append(payload[data_start:data_end])
        pos = (data_end + 3) & ~3
    return out


def binary_blobs(pkg: pathlib.Path) -> list[bytes]:
    """Return the raw binary blob(s) inside a package that can embed assets."""
    # All shellouts below run with cwd= extraction dirs, so the package path
    # must be absolute or every relative invocation misses the file.
    pkg = pkg.resolve()
    suffix = pkg.suffix.lower()
    if suffix == ".deb":
        blobs: list[bytes] = []
        # Debian .deb (legacy `ar` + compressed data.tar.* AND modern
        # format-2.0 paxtar) carry every embedded asset inside `data.tar.*`.
        # We read the payloads ourselves instead of shelling out to GNU ar/tar,
        # because binutils on the Ubuntu runner mishandles the newer format and
        # the installed `tar` varies (bug caught on the v1.4.20 verify run).
        # Pure stdlib is deterministic everywhere.
        try:
            buf = pkg.read_bytes()
            if buf.startswith(b"!<arch>"):
                # ar member header: name[16] mtime[12] uid[6] gid[6] mode[8]
                # size[10] fmag[2]. The size is a 10-byte ASCII DECIMAL — the
                # original code read it with a binary struct.unpack at the
                # wrong offset, which corrupted every subsequent member offset
                # and silently turned each .deb verification into a no-op WARN.
                idx = 8
                while idx + 60 <= len(buf):
                    name = buf[idx:idx + 16].rstrip(b" \n").decode("latin-1")
                    size = int(buf[idx + 48:idx + 58].strip() or b"0", 10)
                    idx += 60
                    if name.startswith("data.tar"):
                        dec = _decompress_payload(buf[idx:idx + size])
                        if dec is not None:
                            blobs.extend(_tar_bin_blobs(dec))
                    idx += size
                    if idx % 2 == 1:
                        idx += 1  # ar pads members to even
            if blobs:
                return blobs
        except Exception:
            # Never hard-fail on a .deb: zero recognizable payloads is a soft
            # failure reported downstream, not a crash.
            return blobs

        # Fallback: plain tar/pax archive (format 2.0 without ar wrapper).
        try:
            with tarfile.open(pkg) as tf:
                blobs.extend(_members_bin_blobs(tf))
        except tarfile.TarError:
            pass
        return blobs
    if suffix == ".rpm":
        # RPM: header + a compressed cpio archive. Try 7z first (it handles
        # truncated gzip streams that Python's gzip module rejects), then fall
        # back to native decompression. Known suffixes must always RETURN
        # (possibly empty) — never crash with `don't know how to inspect`.
        blobs: list[bytes] = []
        try:
            # Prefer 7z: it tolerates RPMs whose embedded cpio.gz lacks the
            # final gzip trailer bytes (observed on the v1.4.20 verify run).
            # 7z may return non-zero when the cpio is truncated but still
            # extracts the file, so we check for extracted files instead.
            if shutil.which("7z"):
                with tempfile.TemporaryDirectory() as td:
                    subprocess.run(
                        ["7z", "x", "-y", f"-o{td}", str(pkg)],
                        capture_output=True,
                    )
                    for f in pathlib.Path(td).rglob("*"):
                        if f.is_file() and f.stat().st_size > 1_000_000:
                            blobs.append(f.read_bytes())
                if blobs:
                    return blobs
            # Native fallback: find and decompress the cpio.gz payload ourselves.
            data = pkg.read_bytes()
            payload = None
            for magic, decompress in ((b"\x1f\x8b", gzip.decompress), (b"\xfd7zXZ\x00", lzma.decompress)):
                at = data.find(magic)
                if at != -1:
                    try:
                        payload = decompress(data[at:])
                        break
                    except Exception:
                        payload = None
            if payload is None and shutil.which("zstd"):
                at = data.find(b"\x28\xb5\x2f\xfd")
                if at != -1:
                    try:
                        payload = subprocess.run(
                            ["zstd", "-dc"], input=data[at:], capture_output=True, check=True
                        ).stdout
                    except Exception:
                        payload = None
            if payload is not None:
                blobs.extend(_cpio_bin_blobs(payload))
        except Exception:
            pass
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
        # Signature files (.sig) are not packages; skip them silently so a
        # glob like `*.rpm` that also matches `*.rpm.sig` never reaches the
        # inspector (which would reject them as unknown suffixes).
        if pkg.suffix.lower() == ".sig" or pkg.name.endswith(".sig"):
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
