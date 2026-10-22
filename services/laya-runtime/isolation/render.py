"""Review-only unit renderer, never an installer or a sandbox attestation."""
import argparse
import hashlib
from pathlib import Path, PurePosixPath
import re
import stat
import sys

HERE = Path(__file__).resolve().parent
RELEASE = re.compile(r"/opt/docmee-laya/releases/[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z")
# Review fingerprints are over LF-normalized UTF-8 templates (portable checkout).
TEMPLATES = {
    "docmee-laya.socket": "9ab9bae5060a621e8e1198d5d94c95f3c9c8f19cf4b88d27790c5b8369f05562",
    "docmee-laya.service": "21e86e04014b6b8ec9f0b9a1ccf66846134776b026d5664e5df4022a1afcad89",
}


def reject_symlink_ancestors(path):
    """Reject existing symlink/reparse ancestors; missing future releases are OK.

    Rendering is not installation. Linux operator sealing remains mandatory;
    source rendering on Windows cannot inspect the future Linux filesystem.
    """
    for item in (path, *path.parents):
        try:
            metadata = item.lstat()
        except FileNotFoundError:
            continue
        if (stat.S_ISLNK(metadata.st_mode)
                or getattr(metadata, "st_file_attributes", 0) & 0x400):
            raise ValueError("unsafe release ancestry")
        if not stat.S_ISDIR(metadata.st_mode):
            raise ValueError("non-directory release ancestry")


def validate_release(release):
    if (not isinstance(release, str) or not RELEASE.fullmatch(release)
            or PurePosixPath(release).name.lower() == "current"):
        raise ValueError("unsafe release")
    if sys.platform == "linux":
        reject_symlink_ancestors(Path(release))
    return release


def render_units(release):
    release = validate_release(release)
    result = {}
    try:
        for name, fingerprint in TEMPLATES.items():
            template = (HERE / (name + ".in")).read_text(encoding="utf-8")
            if hashlib.sha256(template.encode()).hexdigest() != fingerprint:
                raise ValueError("unreviewed template")
            rendered = template.replace("@RELEASE@", release)
            if "@RELEASE@" in rendered:
                raise ValueError("unsafe template expansion")
            result[name] = rendered
    except (OSError, UnicodeError) as error:
        raise ValueError("unavailable template") from error
    return result


def main():
    parser = argparse.ArgumentParser(description="Render reviewed units to stdout only; no installation")
    parser.add_argument("--release", required=True)
    parser.add_argument("--unit", choices=tuple(TEMPLATES), default="docmee-laya.service")
    args = parser.parse_args()
    try:
        result = render_units(args.release)
    except ValueError:
        print("render:FAIL", file=sys.stderr)
        return 1
    print(result[args.unit], end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
