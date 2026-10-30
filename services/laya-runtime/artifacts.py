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
BASE_MODEL_VERSION = 'laya-multilingual-e4e9ddf21a7b'
BASE_CALIBRATION_VERSION = 'upstream-unqualified-v1'

# Docmee menu fine-tune of the pinned base (services/laya-evaluation: menu_training_data_v2.py,
# finetune_menus.py; run r2-s1-e4, laya.train soft-ce, 4 epochs, seed 1, option-order shuffle).
# Frozen final2 evaluation 2026-10-30: 98.1% precision at threshold 0.95, 78% coverage.
DOCMEE_MENUS_MANIFEST = {
    'encoder/config.json': (2018, 'd47190c341517364f62f9d8971544f9ea553474fd5d691b520335b81fad4e2b9'),
    'model.safetensors': (643835524, '23e90a006b5a77543c936e519dfd815167e3242ee1a3b67b904fb896b8e038c0'),
    'rl_agent_config.json': (5194, 'bbc0fc638b4015df4433c4b6563994ddabc82077305be4a6406418c86afc2ffe'),
    'tokenizer/tokenizer.json': (34363285, 'dbba919c6e5e492bc22beb80abb64e6fcc7e8744dc696e8388b8c977767afa4b'),
    'tokenizer/tokenizer_config.json': (648, '5f36fa307ecb9e70c9b058ca0621530f6bd3e89b371c4d6c0279c48d9dbd2629'),
}
DOCMEE_MENUS_MODEL_VERSION = 'laya-docmee-menus-r2s1-23e90a006b5a'
DOCMEE_MENUS_CALIBRATION_VERSION = 'docmee-menus-final2-20261030'

MODEL_MANIFESTS = {BASE_MODEL_VERSION: MANIFEST, DOCMEE_MENUS_MODEL_VERSION: DOCMEE_MENUS_MANIFEST}
CALIBRATIONS = {BASE_MODEL_VERSION: BASE_CALIBRATION_VERSION, DOCMEE_MENUS_MODEL_VERSION: DOCMEE_MENUS_CALIBRATION_VERSION}
# The checkpoint an installed release loads. MANIFEST (above) stays the base for packaging/prepare.py.
ACTIVE_MODEL_VERSION = DOCMEE_MENUS_MODEL_VERSION
ACTIVE_CALIBRATION_VERSION = CALIBRATIONS[ACTIVE_MODEL_VERSION]


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
