"""Closed, immutable checkpoint manifest; verification never prepares artifacts."""
import hashlib
from pathlib import Path, PurePosixPath
import stat

DISTRIBUTION_VERSION = '0.4.8'
MODEL_REPOSITORY = 'convaiinnovations/laya-multilingual'
MODEL_REVISION = 'e4e9ddf21a7b1903b7acffd8814ad4307bf63a67'
MANIFEST = {
    'encoder/config.json': (1938, '83f6916d13ef0f556ac461f28308dc2bffa7ebeadee8ec9e2db5812020ea5bb4'),
    'model.safetensors': (643835514, '9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204'),
    'rl_agent_config.json': (472, '25061739243b617ad88d1219ba6f8a9c86c5881ca28df024fa2d9b3b2fcc30c6'),
    'tokenizer/tokenizer.json': (34363188, '609d8f4c067cd3950f88594c5a802616cea245823836ef5848ee4fc40aab5b6f'),
    'tokenizer/tokenizer_config.json': (524, '6c6b2d8e3c84ce0e671c129cd6b374b235d6f9863042a5836358d00a89bbb5a1'),
}


def _ordinary(path):
    info = path.lstat()
    # Reject Windows junctions/reparse points as well as ordinary symlinks.
    if stat.S_ISLNK(info.st_mode) or getattr(info, 'st_file_attributes', 0) & 0x400:
        raise ValueError()
    return info


def verify_artifacts(directory, manifest=None):
    """Stream-check a closed tree. Custom manifests are for small verifier fixtures."""
    manifest = MANIFEST if manifest is None else manifest
    try:
        root = Path(directory)
        if not root.is_absolute() or '..' in root.parts:
            raise ValueError()
        for parent in (root, *root.parents):
            if not stat.S_ISDIR(_ordinary(parent).st_mode):
                raise ValueError()
        directories = set()
        for name in manifest:
            path = PurePosixPath(name)
            if path.is_absolute() or '..' in path.parts or '\\' in name or ':' in name or str(path) != name:
                raise ValueError()
            directories.update(str(parent) for parent in path.parents if str(parent) != '.')
        seen = set()
        pending = [root]
        while pending:
            for path in pending.pop().iterdir():
                name = path.relative_to(root).as_posix()
                info = _ordinary(path)
                if stat.S_ISDIR(info.st_mode) and name in directories:
                    pending.append(path)
                elif stat.S_ISREG(info.st_mode) and name in manifest:
                    size, expected = manifest[name]
                    if info.st_size != size:
                        raise ValueError()
                    digest = hashlib.sha256()
                    with path.open('rb') as stream:
                        while chunk := stream.read(1024 * 1024):
                            digest.update(chunk)
                    if digest.hexdigest() != expected:
                        raise ValueError()
                    seen.add(name)
                else:
                    raise ValueError()
        if seen != set(manifest):
            raise ValueError()
    except (OSError, ValueError, TypeError):
        raise ValueError('artifact verification failed') from None
