"""Read-only, stdlib package verifier. Run from reviewed source, not the payload.

An authenticated out-of-band inventory digest is mandatory. Filesystem checks
require exclusive trusted access; they do not eliminate concurrent-writer races,
establish ownership, or qualify the Linux/native-code sandbox.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys

INVENTORY = 'release-inventory.json'
MAX_INVENTORY = 1024*1024
MAX_FILE = 1024*1024*1024
MAX_FILES = 4096
TARGET = {
    'implementation_name':'cpython', 'implementation_version':'3.12.0',
    'os_name':'posix', 'platform_machine':'aarch64',
    'platform_python_implementation':'CPython', 'platform_system':'Linux',
    'python_full_version':'3.12.0', 'python_version':'3.12', 'sys_platform':'linux',
}


def ordinary(path, *, directory=False):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info,'st_file_attributes',0)&0x400:
        raise ValueError('symlink or reparse point rejected')
    if not (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)):
        raise ValueError('nonordinary filesystem object')
    return info


def safe_component(part):
    if (not part or part in ('.','..') or any(ord(c)<33 or ord(c)>126 for c in part)
            or any(c in part for c in '\\/:*?"<>|') or part.endswith((' ','.'))
            or re.fullmatch(r'(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?',part)):
        raise ValueError('unsafe path component')


def safe_path(path):
    if (not path.is_absolute() or '..' in path.parts or str(path).startswith(('\\\\','//'))
            or any(ord(c)<32 for c in str(path))):
        raise ValueError('explicit absolute local path required')
    # Absolute host paths can contain spaces (e.g. a Windows user profile).
    for part in path.parts[1:]:
        if (':' in part or part.endswith((' ','.'))
                or re.fullmatch(r'(?i:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?',part)):
            raise ValueError('unsafe absolute path')


def safe_parents(path):
    safe_path(path)
    for parent in (path,*path.parents):
        ordinary(parent,directory=True)


def relative_name(name):
    if not isinstance(name,str) or len(name)>240:
        raise ValueError('invalid inventory path')
    for part in name.split('/'):
        safe_component(part)
    if (str(PurePosixPath(name)) != name
            or name.split('/')[0].casefold() in (INVENTORY.casefold(),'incomplete')):
        raise ValueError('reserved or noncanonical path')
    return name


def hex_string(value,length):
    if not isinstance(value,str) or not re.fullmatch('[0-9a-f]{'+str(length)+'}',value):
        raise ValueError('invalid digest or revision')


def exact_keys(value,keys):
    if not isinstance(value,dict) or set(value) != set(keys):
        raise ValueError('invalid inventory schema')


def validate_inventory(data):
    exact_keys(data,('schema_version','source_baseline_commit','runtime_origin_commit','target','model','lock','files'))
    if type(data['schema_version']) is not int or data['schema_version'] != 1:
        raise ValueError('unsupported inventory version')
    for key in ('source_baseline_commit','runtime_origin_commit'):
        hex_string(data[key],40)
    if data['target'] != TARGET:
        raise ValueError('wrong target')
    exact_keys(data['model'],('repository','revision'))
    if data['model']['repository'] != 'convaiinnovations/laya-multilingual':
        raise ValueError('wrong model repository')
    hex_string(data['model']['revision'],40)
    exact_keys(data['lock'],('filename','sha256'))
    if data['lock']['filename'] != 'arm64-cp312.lock.json':
        raise ValueError('wrong lock filename')
    hex_string(data['lock']['sha256'],64)
    files = data['files']
    if not isinstance(files,list) or not 0<len(files)<=MAX_FILES:
        raise ValueError('invalid inventory file count')
    records = {}
    aliases = set()
    directories = set()
    for record in files:
        exact_keys(record,('path','size','sha256'))
        name = relative_name(record['path'])
        if name.casefold() in aliases:
            raise ValueError('duplicate or aliased inventory path')
        aliases.add(name.casefold())
        if type(record['size']) is not int or not 0<=record['size']<=MAX_FILE:
            raise ValueError('invalid file size')
        hex_string(record['sha256'],64)
        records[name] = record
        directories.update(str(p) for p in PurePosixPath(name).parents if str(p)!='.')
    if aliases & {name.casefold() for name in directories}:
        raise ValueError('file/directory collision')
    # Case-insensitive directory aliases must not collapse differently on Windows.
    if len({name.casefold() for name in directories}) != len(directories):
        raise ValueError('aliased directory')
    return records,directories


def inventory_bytes(data):
    validate_inventory(data)
    ordered = dict(data,files=sorted(data['files'],key=lambda record:record['path']))
    raw = (json.dumps(ordered,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
    if len(raw)>MAX_INVENTORY:
        raise ValueError('oversized inventory')
    return raw


def verify_tree(root,data, *, extra_files=()):
    """Closed file/directory scan shared with assembly before marker removal."""
    safe_parents(root)
    records,directories = validate_inventory(data)
    seen,seen_dirs = set(),set()
    pending = [root]
    while pending:
        for path in pending.pop().iterdir():
            name = path.relative_to(root).as_posix()
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode) and name in directories:
                ordinary(path,directory=True)
                seen_dirs.add(name)
                pending.append(path)
            elif name in records or name in extra_files:
                info = ordinary(path)
                if name not in records:
                    continue
                record = records[name]
                if info.st_size != record['size']:
                    raise ValueError('file size mismatch')
                digest,count = hashlib.sha256(),0
                with path.open('rb') as stream:
                    while chunk := stream.read(min(1024*1024,record['size']-count+1)):
                        count += len(chunk)
                        if count>record['size']:
                            raise ValueError('oversized file')
                        digest.update(chunk)
                if count != record['size'] or digest.hexdigest() != record['sha256']:
                    raise ValueError('file size or SHA-256 mismatch')
                seen.add(name)
            else:
                raise ValueError('unexpected package object')
    if seen != set(records) or seen_dirs != directories:
        raise ValueError('missing package object')


def unique_object(pairs):
    result = {}
    for key,value in pairs:
        if key in result:
            raise ValueError('duplicate inventory key')
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError('nonfinite JSON value')


def verify_release(directory,expected_sha256):
    """Hash bounded inventory BEFORE parsing; stream-verify payload, no writes."""
    try:
        hex_string(expected_sha256,64)
        root = Path(directory)
        safe_parents(root)
        path = root/INVENTORY
        if ordinary(path).st_size>MAX_INVENTORY:
            raise ValueError('oversized inventory')
        with path.open('rb') as stream:
            raw = stream.read(MAX_INVENTORY+1)
        if len(raw)>MAX_INVENTORY or hashlib.sha256(raw).hexdigest() != expected_sha256:
            raise ValueError('inventory SHA-256 mismatch')
        data = json.loads(raw.decode('utf-8'),object_pairs_hook=unique_object,parse_constant=reject_constant)
        verify_tree(root,data,extra_files=(INVENTORY,))
        return data
    except (OSError,ValueError,TypeError,RecursionError):
        raise ValueError('release verification failed') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command',required=True)
    verify = commands.add_parser('verify')
    verify.add_argument('package',help='absolute package directory')
    verify.add_argument('--inventory-sha256',required=True,help='trusted out-of-band SHA-256')
    args = parser.parse_args()
    try:
        verify_release(args.package,args.inventory_sha256)
    except ValueError:
        print('release:FAIL',file=sys.stderr)
        return 1
    print('release:PASS (integrity only; not Linux qualification)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
