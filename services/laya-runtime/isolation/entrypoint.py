"""Fixed release entry for -I -B; no cwd, environment or arbitrary import path."""
from pathlib import Path
import re
import stat
import sys


def main():
    if sys.platform != "linux" or not sys.flags.isolated or not sys.flags.dont_write_bytecode:
        return 1
    entry = Path(__file__).absolute()
    release = entry.parent.parent
    if (not re.fullmatch(r"/opt/docmee-laya/releases/[A-Za-z0-9][A-Za-z0-9_-]{0,79}", str(release))
            or release.name.lower() == "current" or entry.name != "entrypoint.py"
            or entry.parent.name != "isolation" or sys.argv[1:]):
        return 1
    # Check this trusted entry and fixed runtime sources before extending sys.path.
    # Full venv/model-tree sealing is a separate mandatory operator gate.
    sources = [release / "runtime" / name for name in ("server.py", "protocol.py", "backend.py", "artifacts.py")]
    paths = {entry, *sources}
    for path in tuple(paths):
        paths.update(path.parents)
    try:
        for path in paths:
            metadata = path.lstat()
            if (stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0
                    or metadata.st_mode & 0o022):
                return 1
    except OSError:
        return 1
    sys.path.insert(0, str(release / "runtime"))
    from server import main as serve
    sys.argv = [str(release / "runtime" / "server.py"), "--systemd-socket",
                "--artifact-dir", str(release / "model")]
    return serve()


if __name__ == "__main__":
    raise SystemExit(main())
