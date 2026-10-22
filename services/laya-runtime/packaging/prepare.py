"""Explicit offline package preparation; standard library, no install/inference.

Use only this reviewed local lock and runtime source. Never run automatically from
server startup. A trusted operator must exclude concurrent/untrusted filesystem
writers; path checks are not OS-enforced ownership or a native-code sandbox.
"""
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from types import ModuleType
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener

HERE = Path(__file__).resolve().parent
RUNTIME = HERE.parent
sys.path.insert(0,str(RUNTIME))
from lock_validation import TARGET, inspect_wheel, verify_closure
from release_inventory import INVENTORY, inventory_bytes, ordinary, safe_path, safe_parents, verify_tree

LOCK = HERE / 'arm64-cp312.lock.json'
SOURCE_BASE = 'd17cd150b11d9ed3efa91ac74d9a0a5dc312f44d'
REVIEWED_SOURCE_BASE = '6317f8ecf4b75b5fb5923093d3a987289ea0fd21'
# Exact Git blob bytes from REVIEWED_SOURCE_BASE, not hashes of a dirty checkout.
# Check out these reviewed files with LF endings; never silently normalize them.
SOURCE_PINS = {
    'artifacts.py': (3021, 'e2c668945e8dca897246c53f173bf92b53f200d0c3b633c2b669b4d36a0a1aaf'),
    'backend.py': (5254, '3ff4183c1afd25f87ce5235fcfa56060dd3f822f8249dab078beb866760051c9'),
    'protocol.py': (3837, '7dec7e6aa3eef959657c080c831260cbbb6e3a1b3af95aaaf6546894d5f89265'),
    'server.py': (15540, '51c073125073ac25a749697c4903d3d2fef8426bf322264b25fbbc9f5ccebf77'),
    'isolation/entrypoint.py': (1523, '9207e8244d271f254a0e0e9cda282e7e92b9e9d627ce002ab3eea20e0b3e3fe1'),
    'isolation/render.py': (2829, '1c2bb413668ab682fd1486b3d95430ef1622a0024cc89896bc5315276c9b3d73'),
    'isolation/probe.py': (3001, '1f7448f99399647b0d86b72ad1397933f334d5edb9a82d70e64324c8a438bacd'),
    'isolation/docmee-laya.service.in': (1785, '21e86e04014b6b8ec9f0b9a1ccf66846134776b026d5664e5df4022a1afcad89'),
    'isolation/docmee-laya.socket.in': (290, '9ab9bae5060a621e8e1198d5d94c95f3c9c8f19cf4b88d27790c5b8369f05562'),
}
LOCK_PIN = (59604, '209fb9cc8378a63e243896676216d73f076946f3a23266a2668fff614eed2655')
SOURCES = ('artifacts.py','backend.py','protocol.py','server.py')
ORIGINAL_TOKENIZER = (502,'424b69444bf7b5809dc2cd2e36d0bd71b8055124dd24274d6db3c655d38205e7')
HOSTS = {'files.pythonhosted.org','download-r2.pytorch.org','huggingface.co'}
REDIRECT_HOSTS = HOSTS | {'download.pytorch.org','cas-bridge.xethub.hf.co',
                         'cdn-lfs.huggingface.co','cdn-lfs-us-1.hf.co','cdn-lfs-eu-1.hf.co'}
PINS = {'laya':'0.4.8','torch':'2.14.1+cpu','transformers':'5.20.1',
        'tokenizers':'0.23.3','safetensors':'0.8.0','pip':'26.2.2'}


def validate_url(url, *, redirect=False):
    if not isinstance(url,str) or any(ord(c)<33 or ord(c)>126 for c in url) or '\\' in url:
        raise ValueError('unsafe artifact URL')
    parsed = urlsplit(url)
    if (parsed.scheme != 'https' or parsed.hostname not in (REDIRECT_HOSTS if redirect else HOSTS)
            or parsed.username or parsed.password or parsed.port is not None or parsed.fragment
            or parsed.query and not redirect or unquote(parsed.path).count('..')):
        raise ValueError('unsafe artifact URL')
    return url


class _Redirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl,redirect=True)
        return super().redirect_request(req,fp,code,msg,headers,newurl)


def open_artifact(url):
    # No ambient proxy credentials, cookie jar, authentication or caller headers.
    validate_url(url)
    return build_opener(ProxyHandler({}),_Redirects()).open(url,timeout=30)


def new_output(directory):
    root = Path(directory)
    safe_path(root)
    if not root.is_absolute() or '..' in root.parts or root == Path(root.anchor):
        raise ValueError('new explicit absolute destination required')
    safe_parents(root.parent)
    if root.exists() or root.is_symlink():
        raise ValueError('destination already exists')
    root.mkdir(mode=0o700)
    with (root/'INCOMPLETE').open('xb') as stream:
        stream.write(b'Package incomplete. Do not install or load.\n')
    return root


def checked_bytes(body,size,digest):
    if len(body) != size or hashlib.sha256(body).hexdigest() != digest:
        raise ValueError('artifact size or SHA-256 mismatch')
    return body


def checked_source(path,pin):
    safe_parents(path.parent)
    if ordinary(path).st_size != pin[0]:
        raise ValueError('unreviewed source size')
    with path.open('rb') as stream:
        return checked_bytes(stream.read(pin[0]+1),*pin)


def reviewed_sources():
    return {name:checked_source(RUNTIME/name,pin) for name,pin in SOURCE_PINS.items()}


# Execute exactly the reviewed bytes, never a timestamp-valid bytecode cache or
# a preloaded module. This private namespace is not registered in sys.modules.
_artifacts = ModuleType('_docmee_packaging_artifacts')
_artifacts.__file__ = str(RUNTIME/'artifacts.py')
_artifacts_source = checked_source(RUNTIME/'artifacts.py',SOURCE_PINS['artifacts.py'])
exec(compile(_artifacts_source,_artifacts.__file__,'exec',dont_inherit=True),
     _artifacts.__dict__)
MANIFEST = _artifacts.MANIFEST
MODEL_REPOSITORY = _artifacts.MODEL_REPOSITORY
MODEL_REVISION = _artifacts.MODEL_REVISION
verify_artifacts = _artifacts.verify_artifacts


def place_bytes(path,body):
    """No overwrites; atomic hard-link placement on the same filesystem."""
    safe_path(path)
    safe_parents(path.parent)
    if path.exists() or path.is_symlink():
        raise ValueError('existing artifact rejected')
    fd, temporary = tempfile.mkstemp(prefix='.partial-',dir=path.parent)
    temp = Path(temporary)
    try:
        with os.fdopen(fd,'wb') as stream:
            stream.write(body)
        safe_parents(path.parent)
        os.link(temp,path)
    finally:
        temp.unlink()


def download(record,path, *, opener=open_artifact):
    """Bounded streaming, hash before atomic placement; fake streams in tests."""
    path = Path(path)
    safe_path(path)
    validate_url(record['url'])
    size, expected = record['size'],record['sha256']
    if type(size) is not int or not 0 < size <= 1024*1024*1024 or not re.fullmatch('[0-9a-f]{64}',expected):
        raise ValueError('invalid artifact bounds')
    safe_parents(path.parent)
    if path.exists() or path.is_symlink():
        raise ValueError('existing artifact rejected')
    fd, temporary = tempfile.mkstemp(prefix='.partial-',dir=path.parent)
    temp = Path(temporary)
    try:
        digest = hashlib.sha256()
        count = 0
        with os.fdopen(fd,'wb') as target, closing(opener(record['url'])) as source:
            while chunk := source.read(min(1024*1024,size-count+1)):
                count += len(chunk)
                if count > size:
                    raise ValueError('oversized artifact')
                digest.update(chunk)
                target.write(chunk)
        if count != size or digest.hexdigest() != expected:
            raise ValueError('artifact size or SHA-256 mismatch')
        safe_parents(path.parent)
        os.link(temp,path)
    finally:
        temp.unlink()


def normalize_tokenizer(body):
    checked_bytes(body,*ORIGINAL_TOKENIZER)
    data = json.loads(body)
    if data['extra_special_tokens'] != ['<start_of_turn>','<end_of_turn>']:
        raise ValueError('unexpected tokenizer schema')
    data['extra_special_tokens'] = {'extra_0':'<start_of_turn>','extra_1':'<end_of_turn>'}
    prepared = json.dumps(data,indent=2).encode('utf-8')
    return checked_bytes(prepared,*MANIFEST['tokenizer/tokenizer_config.json'])


def read_lock():
    lock = json.loads(checked_source(LOCK,LOCK_PIN))
    if (lock['schema_version'] != 1 or any(lock['target'].get(k) != v for k,v in TARGET.items())
            or lock['roots'] != list(PINS)[:-1] or lock['bootstrap'] != 'pip'):
        raise ValueError('wrong target lock')
    records = {w['name']:w for w in lock['wheels']}
    if any(records[n]['version'] != v for n,v in PINS.items()):
        raise ValueError('required runtime pin mismatch')
    for name, digest in (('laya','05064d8b949803af8cb173561ed0b24d6be5b62cb86d8d319321577c630d0288'),
                         ('torch','2af649994b36dffc627175c3f306d9e513a309b58d4619ac7107577613336454')):
        if records[name]['sha256'] != digest:
            raise ValueError('required runtime hash mismatch')
    for record in lock['wheels']:
        validate_url(record['url'])
        if unquote(urlsplit(record['url']).path).split('/')[-1] != record['filename']:
            raise ValueError('artifact URL/filename mismatch')
        if Path(record['filename']).name != record['filename'] or ':' in record['filename'] or '\\' in record['filename']:
            raise ValueError('unsafe wheel filename')
    verify_closure(lock['wheels'],lock['roots']+[lock['bootstrap']])
    return lock


def prepare(directory, *, opener=open_artifact):
    root = new_output(directory)
    # Any exception preserves INCOMPLETE and all validated artifacts for diagnosis.
    lock = read_lock()
    sources = reviewed_sources()
    # Retain these bytes, rather than rereading a potentially changed lock later.
    lock_body = checked_source(LOCK,LOCK_PIN)
    for name in ('wheels','bootstrap','model','runtime','isolation'):
        (root/name).mkdir(mode=0o700)
    for record in lock['wheels']:
        folder = 'bootstrap' if record['name'] == lock['bootstrap'] else 'wheels'
        path = root/folder/record['filename']
        download(record,path,opener=opener)
        inspect_wheel(path,record)
    source_hashes = {}
    records = {}
    for name,body in sources.items():
        destination = name if name.startswith('isolation/') else 'runtime/'+name
        place_bytes(root/destination,body)
        size,digest = SOURCE_PINS[name]
        records[destination] = {'path':destination,'size':size,'sha256':digest}
        if name in SOURCES:
            source_hashes[name] = {'size':size,'sha256':digest}
    for name, (size,digest) in MANIFEST.items():
        path = root/'model'/name
        path.parent.mkdir(parents=True,exist_ok=True)
        safe_parents(path.parent)
        record = dict(url=f'https://huggingface.co/{MODEL_REPOSITORY}/resolve/{MODEL_REVISION}/{name}',size=size,sha256=digest)
        if name == 'tokenizer/tokenizer_config.json':
            record.update(size=ORIGINAL_TOKENIZER[0],sha256=ORIGINAL_TOKENIZER[1])
            temporary = root/'tokenizer-original.json'
            download(record,temporary,opener=opener)
            place_bytes(path,normalize_tokenizer(temporary.read_bytes()))
            temporary.unlink()
        else:
            download(record,path,opener=opener)
    verify_artifacts(root/'model')
    requirements = ''.join(f"{r['name']}=={r['version']} --hash=sha256:{r['sha256']}\n"
                           for r in lock['wheels'] if r['name'] != lock['bootstrap'])
    place_bytes(root/'requirements.txt',requirements.encode('ascii'))
    lock_name = 'arm64-cp312.lock.json'
    place_bytes(root/lock_name,lock_body)
    metadata = {'schema_version':1,'source_baseline_commit':REVIEWED_SOURCE_BASE,
                'runtime_origin_commit':SOURCE_BASE,
                'runtime_sources':source_hashes,'model_revision':MODEL_REVISION,
                'lock_sha256':hashlib.sha256(lock_body).hexdigest(),
                'target':lock['target'],'status':'prepared-not-installed-not-ARM-executed',
                'filesystem_isolation':'operator-required; not enforced by this tool'}
    metadata_body = json.dumps(metadata,indent=2).encode('utf-8')
    place_bytes(root/'package.json',metadata_body)
    for record in lock['wheels']:
        folder = 'bootstrap' if record['name'] == lock['bootstrap'] else 'wheels'
        name = folder+'/'+record['filename']
        records[name] = dict(path=name,size=record['size'],sha256=record['sha256'])
    for name,(size,digest) in MANIFEST.items():
        name = 'model/'+name
        records[name] = dict(path=name,size=size,sha256=digest)
    for name,body in ((lock_name,lock_body),('requirements.txt',requirements.encode('ascii')),('package.json',metadata_body)):
        records[name] = dict(path=name,size=len(body),sha256=hashlib.sha256(body).hexdigest())
    inventory = dict(schema_version=1,source_baseline_commit=REVIEWED_SOURCE_BASE,runtime_origin_commit=SOURCE_BASE,
                     target=lock['target'],model=dict(repository=MODEL_REPOSITORY,revision=MODEL_REVISION),
                     lock=dict(filename=lock_name,sha256=metadata['lock_sha256']),files=list(records.values()))
    body = inventory_bytes(inventory)
    # Reject all unlisted files AND directories while the failure marker remains.
    verify_tree(root,inventory,extra_files=('INCOMPLETE',))
    place_bytes(root/INVENTORY,body)
    verify_tree(root,inventory,extra_files=('INCOMPLETE',INVENTORY))
    ordinary(root/'INCOMPLETE')
    (root/'INCOMPLETE').unlink()
    return root


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',required=True,help='new absolute output directory; parent must already exist')
    args = parser.parse_args()
    try:
        root = prepare(args.output)
    except (OSError,ValueError,KeyError,TypeError):
        print('package preparation failed; inspect INCOMPLETE output, do not install',file=sys.stderr)
        return 1
    print('package prepared; no install, ARM execution or qualification performed')
    print('inventory-sha256: '+hashlib.sha256((root/INVENTORY).read_bytes()).hexdigest())
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
