"""Small real filesystem/ZIP fixtures; no network or downloaded code execution."""
import hashlib
import io
import json
import os
from pathlib import Path
import py_compile
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
import stat
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))


class PackagingTests(unittest.TestCase):
    def setUp(self):
        # Missing implementation is asserted as RED rather than hidden by import errors.
        self.assertTrue((HERE / 'prepare.py').is_file(), 'offline preparation tool is missing')
        import prepare
        import lock_validation
        self.p = prepare
        self.v = lock_validation
        self.temp = tempfile.TemporaryDirectory(prefix='laya-package-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def wheel(self, name='demo', version='1.0', requires=(), python='>=3.10', tag='py3-none-any', extras=()):
        metadata = (f'Metadata-Version: 2.1\nName: {name}\nVersion: {version}\nRequires-Python: {python}\n'
                    + ''.join(f'Requires-Dist: {r}\n' for r in requires)
                    + ''.join(f'Provides-Extra: {e}\n' for e in extras) + '\n').encode()
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            z.writestr(f'{name}-{version}.dist-info/METADATA', metadata)
        raw = out.getvalue()
        filename = f'{name}-{version}-{tag}.whl'
        record = dict(name=name, version=version, filename=filename,
                      url='https://files.pythonhosted.org/packages/aa/' + filename,
                      size=len(raw), sha256=hashlib.sha256(raw).hexdigest(),
                      metadata_sha256=hashlib.sha256(metadata).hexdigest(),
                      requires_python=python, requires_dist=list(requires), provides_extra=list(extras))
        return record, raw

    def test_valid_wheel_metadata_and_target_closure(self):
        a, raw = self.wheel(requires=('other[feature]>=2; sys_platform == "linux"',))
        b, _ = self.wheel('other', '2.0', extras=('feature',))
        self.v.inspect_wheel(io.BytesIO(raw), a)
        self.v.verify_closure([a, b], ['demo'])

    def test_missing_dependency_wrong_version_extra_and_python_fail(self):
        a, _ = self.wheel(requires=('other[feature]>=2',))
        b, _ = self.wheel('other', '1.0')
        for records in ([a], [a,b]):
            with self.subTest(records=len(records)), self.assertRaises(ValueError):
                self.v.verify_closure(records, ['demo'])
        a, _ = self.wheel(python='>=3.13')
        with self.assertRaises(ValueError):
            self.v.verify_closure([a], ['demo'])
        b, _ = self.wheel('other', '2.0')
        a, _ = self.wheel(requires=('other[feature]>=2',))
        with self.assertRaises(ValueError):
            self.v.verify_closure([a,b], ['demo'])

    def test_linux_markers_not_windows_and_unknown_marker_fails(self):
        a, _ = self.wheel(requires=('colorama; platform_system == "Windows"',
                                    'old; python_version < "3.11"'))
        self.v.verify_closure([a], ['demo'])
        for marker in ('mystery == "foo"', 'platform_release == "6.8"',
                       'extra == "unused" and mystery == "x"', 'python_version >>> "3"'):
            with self.subTest(marker=marker), self.assertRaises(ValueError):
                self.v.marker_applies(marker, '')

    def test_marker_precedence_parentheses_and_versions(self):
        self.assertTrue(self.v.marker_applies('(platform_system == "Darwin" or platform_machine == "aarch64") and python_version >= "3.9"', ''))
        self.assertFalse(self.v.marker_applies('python_version < "3.9" or extra == "foo"', ''))
        self.assertTrue(self.v.satisfies('2.14.1+cpu', '>=2.6,<3'))
        self.assertTrue(self.v.satisfies('1.3.0', '>=1.1.0,<1.4'))
        self.assertTrue(self.v.satisfies('3.12.0', '>=3.10,!=3.11.*'))
        with self.assertRaises(ValueError):
            self.v.satisfies('1.0', '===magic')

    def test_extras_propagate_to_fixed_point_and_unused_wheels_fail(self):
        a, _ = self.wheel(requires=('other[feature]',))
        b, _ = self.wheel('other', '2.0', requires=('third; extra == "feature"',), extras=('feature',))
        c, _ = self.wheel('third')
        with self.assertRaises(ValueError):
            self.v.verify_closure([a,b], ['demo'])
        self.v.verify_closure([a,b,c], ['demo'])
        with self.assertRaises(ValueError):
            self.v.verify_closure([a,b,c], ['third'])

    def test_wheel_target_compatibility(self):
        good = ('cp312-cp312-manylinux_2_28_aarch64', 'cp310-abi3-manylinux2014_aarch64',
                'py3-none-any','py2.py3-none-any')
        bad = ('cp311-cp311-manylinux_2_28_aarch64', 'cp313-abi3-manylinux_2_28_aarch64',
               'cp312-cp312-any', 'cp310-abi3-any', 'cp312-none-any',
               'cp312-cp312-any.manylinux_2_28_aarch64',
               'cp312-cp312-manylinux_2_40_aarch64', 'cp312-cp312-win_arm64',
               'cp312-cp312-manylinux_2_28_x86_64', 'cp312-cp312-musllinux_1_2_aarch64')
        for tag in good:
            self.v.wheel_compatible('demo-1.0-' + tag + '.whl')
        for tag in bad:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                self.v.wheel_compatible('demo-1.0-' + tag + '.whl')

    def test_tampered_metadata_or_duplicate_distribution_rejected(self):
        a, raw = self.wheel()
        a['version'] = '9.0'
        with self.assertRaises(ValueError):
            self.v.inspect_wheel(io.BytesIO(raw), a)
        a, _ = self.wheel()
        with self.assertRaises(ValueError):
            self.v.verify_closure([a,a], ['demo'])

    def test_download_hash_size_truncation_and_oversize(self):
        a, raw = self.wheel()
        path = self.root / a['filename']
        self.p.download(a, path, opener=lambda url: io.BytesIO(raw))
        self.assertEqual(path.read_bytes(), raw)
        for body, size, digest in ((raw[:-1],len(raw),a['sha256']), (raw+b'x',len(raw),a['sha256']),
                                   (raw,len(raw),'0'*64), (raw,len(raw)+1,a['sha256'])):
            with self.subTest(size=size,body=len(body)), self.assertRaises(ValueError):
                self.p.download(dict(a,size=size,sha256=digest), self.root / ('bad'+str(size)+str(len(body))), opener=lambda url: io.BytesIO(body))

    def test_unsafe_urls_existing_files_and_symlinks(self):
        a, raw = self.wheel()
        for url in ('http://files.pythonhosted.org/a', 'https://evil.test/a',
                    'https://user:pass@files.pythonhosted.org/a', 'https://files.pythonhosted.org:444/a',
                    'https://files.pythonhosted.org/a?token=x', 'https://files.pythonhosted.org/a#x'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.p.download(dict(a,url=url), self.root / 'unsafe', opener=lambda url: io.BytesIO(raw))
        path = self.root / 'existing'
        path.write_bytes(b'partial')
        with self.assertRaises(ValueError):
            self.p.download(a,path,opener=lambda url: io.BytesIO(raw))
        self.assertEqual(path.read_bytes(),b'partial')
        link = self.root / 'link'
        try:
            link.symlink_to(path)
        except OSError:
            self.skipTest('Windows user lacks symlink privilege')
        with self.assertRaises(ValueError):
            self.p.download(a,link,opener=lambda url: io.BytesIO(raw))

    def test_destination_must_be_new_absolute_safe_directory(self):
        for path in (Path('relative'),self.root,self.root / '..' / 'escape',self.root.anchor):
            with self.subTest(path=str(path)), self.assertRaises(ValueError):
                self.p.new_output(path)
        new = self.root / 'new'
        self.p.new_output(new)
        self.assertTrue((new / 'INCOMPLETE').is_file())

    def test_failure_leaves_incomplete_marker(self):
        output = self.root / 'failed'
        def fail(url):
            raise OSError('network unavailable')
        with self.assertRaises(OSError):
            self.p.prepare(output,opener=fail)
        self.assertTrue((output / 'INCOMPLETE').is_file())
        self.assertFalse((output / 'package.json').exists())

    def test_checked_in_lock_closes_for_target(self):
        lock = self.p.read_lock()
        self.assertEqual(len(lock['wheels']),36)
        self.v.verify_closure(lock['wheels'],lock['roots']+[lock['bootstrap']])

    def helper_fixture(self):
        source = self.root/'source'
        packaging = source/'packaging'
        packaging.mkdir(parents=True)
        for name in ('prepare.py','lock_validation.py','release_inventory.py'):
            shutil.copyfile(HERE/name,packaging/name)
        shutil.copyfile(HERE.parent/'artifacts.py',source/'artifacts.py')
        return source,packaging

    def isolated_python(self, packaging, script):
        result = subprocess.run([sys.executable,'-I','-B','-c',
                                 'import sys; sys.path[:0]='+repr([str(packaging),str(packaging.parent)])+'; '+script],
                                capture_output=True,text=True,check=True,timeout=15)
        return result.stdout.strip()

    def test_checked_helper_ignores_conflicting_timestamp_valid_bytecode(self):
        source,packaging = self.helper_fixture()
        path = source/'artifacts.py'
        original = path.read_bytes()
        expected = 'e4e9ddf21a7b1903b7acffd8814ad4307bf63a67'
        conflicting = '0'*40
        changed = original.replace(expected.encode(),conflicting.encode())
        self.assertNotEqual(changed,original)
        self.assertEqual(len(changed),len(original))
        path.write_bytes(changed)
        stamp = path.stat()
        py_compile.compile(str(path),doraise=True,
                           invalidation_mode=py_compile.PycInvalidationMode.TIMESTAMP)
        path.write_bytes(original)
        os.utime(path,ns=(stamp.st_atime_ns,stamp.st_mtime_ns))
        # Control: -B still permits this real timestamp/size-valid cache read.
        self.assertEqual(self.isolated_python(packaging,
            'import artifacts; print(artifacts.MODEL_REVISION)'),conflicting)
        self.assertEqual(self.isolated_python(packaging,
            'import prepare; print(prepare.MODEL_REVISION)'),expected)

    def test_checked_helper_ignores_preloaded_artifacts_module(self):
        _,packaging = self.helper_fixture()
        script = ('import types; cached=types.ModuleType("artifacts"); '
                  'cached.MANIFEST={}; cached.MODEL_REPOSITORY="unreviewed"; '
                  'cached.MODEL_REVISION="unreviewed"; cached.verify_artifacts=lambda path: None; '
                  'sys.modules["artifacts"]=cached; import prepare; '
                  'print(prepare.MODEL_REVISION)')
        self.assertEqual(self.isolated_python(packaging,script),
                         'e4e9ddf21a7b1903b7acffd8814ad4307bf63a67')

    def test_dirty_runtime_or_isolation_sources_fail_before_network(self):
        import shutil
        source = self.root/'source'
        shutil.copytree(HERE.parent,source,ignore=shutil.ignore_patterns('__pycache__'))
        for name in ('artifacts.py','backend.py','protocol.py','server.py','isolation/entrypoint.py','isolation/render.py','isolation/probe.py',
                     'isolation/docmee-laya.service.in','isolation/docmee-laya.socket.in'):
            path = source/name
            original = path.read_bytes()
            for index,body in enumerate((original+b'\n',b'X'+original[1:])):
                path.write_bytes(body)
                output = self.root/('dirty-'+str(index)+'-'+name.replace('/','-'))
                with patch.object(self.p,'RUNTIME',source),self.subTest(name=name,mutation=index),self.assertRaises(ValueError):
                    self.p.prepare(output,opener=lambda url: (_ for _ in ()).throw(AssertionError('network before source validation')))
                self.assertTrue((output/'INCOMPLETE').is_file())
            path.write_bytes(original)

    def test_mutated_lock_bytes_fail_even_with_same_json(self):
        lock = self.root/'dirty.lock.json'
        lock.write_bytes(self.p.LOCK.read_bytes()+b'\n')
        with patch.object(self.p,'LOCK',lock),self.assertRaises(ValueError):
            self.p.read_lock()

    def test_wrong_required_lock_target_rejected_before_network(self):
        original = self.p.LOCK.read_bytes()
        lockfile = self.root/'wrong-target.lock.json'
        for key in self.v.TARGET:
            for mode in ('wrong','missing'):
                lock = json.loads(original)
                if mode == 'wrong':
                    lock['target'][key] = 'incorrect'
                else:
                    del lock['target'][key]
                body = json.dumps(lock).encode()
                lockfile.write_bytes(body)
                output = self.root/(key+'-'+mode)
                with self.subTest(key=key,mode=mode), patch.object(self.p,'LOCK',lockfile), patch.object(self.p,'LOCK_PIN',(len(body),hashlib.sha256(body).hexdigest())):
                    with self.assertRaisesRegex(ValueError,'wrong target lock'):
                        self.p.prepare(output,opener=lambda url: (_ for _ in ()).throw(AssertionError('network before target validation')))
                self.assertTrue((output/'INCOMPLETE').is_file())
                self.assertFalse((output/'release-inventory.json').exists())

    def test_tokenizer_original_and_prepared_hashes(self):
        original = b'{\n  "bos_token": "<bos>",\n  "clean_up_tokenization_spaces": false,\n  "cls_token": "<bos>",\n  "eos_token": "<eos>",\n  "extra_special_tokens": [\n    "<start_of_turn>",\n    "<end_of_turn>"\n  ],\n  "mask_token": "<mask>",\n  "model_input_names": [\n    "input_ids",\n    "attention_mask"\n  ],\n  "model_max_length": 8192,\n  "pad_token": "<pad>",\n  "padding_side": "right",\n  "sep_token": "<eos>",\n  "spaces_between_special_tokens": false,\n  "tokenizer_class": "PreTrainedTokenizerFast",\n  "unk_token": "<unk>"\n}'
        result = self.p.normalize_tokenizer(original)
        self.assertEqual(len(result),524)
        self.assertEqual(hashlib.sha256(result).hexdigest(),'6c6b2d8e3c84ce0e671c129cd6b374b235d6f9863042a5836358d00a89bbb5a1')
        self.assertEqual(json.loads(result)['extra_special_tokens'],{'extra_0':'<start_of_turn>','extra_1':'<end_of_turn>'})
        with self.assertRaises(ValueError):
            self.p.normalize_tokenizer(original+b'\n')

    def test_model_tree_uses_production_closed_verifier(self):
        model = self.root / 'model'
        model.mkdir()
        (model / 'config.json').write_bytes(b'{}')
        manifest = {'config.json':(2,hashlib.sha256(b'{}').hexdigest())}
        with patch.object(self.p._artifacts,'MANIFEST',manifest):
            self.p.verify_artifacts(model)
            (model / 'extra').write_bytes(b'x')
            with self.assertRaises(ValueError):
                self.p.verify_artifacts(model)
            (model / 'extra').unlink()
            (model / 'config.json').unlink()
            with self.assertRaises(ValueError):
                self.p.verify_artifacts(model)

    def test_reparse_points_and_link_ancestors_are_rejected(self):
        fake = SimpleNamespace(st_mode=stat.S_IFDIR,st_file_attributes=0x400)
        with patch.object(Path,'lstat',return_value=fake), self.assertRaises(ValueError):
            self.p.safe_parents(self.root)
        fake = SimpleNamespace(st_mode=stat.S_IFLNK,st_file_attributes=0)
        with patch.object(Path,'lstat',return_value=fake), self.assertRaises(ValueError):
            self.p.safe_parents(self.root)

    def test_unsafe_destination_names_rejected(self):
        for name in ('CON','nul.txt','trailing.','trailing ','stream:name'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.p.new_output(self.root/name)

    def test_redirect_validation_blocks_unapproved_destinations(self):
        self.p.validate_url('https://cas-bridge.xethub.hf.co/public?signature=public',redirect=True)
        for url in ('http://cas-bridge.xethub.hf.co/a','https://attacker.test/a','https://huggingface.co@evil.test/a'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.p.validate_url(url,redirect=True)

    def test_complete_package_fake_network_and_closed_model_validation(self):
        original = b'{\n  "bos_token": "<bos>",\n  "clean_up_tokenization_spaces": false,\n  "cls_token": "<bos>",\n  "eos_token": "<eos>",\n  "extra_special_tokens": [\n    "<start_of_turn>",\n    "<end_of_turn>"\n  ],\n  "mask_token": "<mask>",\n  "model_input_names": [\n    "input_ids",\n    "attention_mask"\n  ],\n  "model_max_length": 8192,\n  "pad_token": "<pad>",\n  "padding_side": "right",\n  "sep_token": "<eos>",\n  "spaces_between_special_tokens": false,\n  "tokenizer_class": "PreTrainedTokenizerFast",\n  "unk_token": "<unk>"\n}'
        bodies = {name:b'fixture' for name in self.p.MANIFEST}
        bodies['tokenizer/tokenizer_config.json'] = self.p.normalize_tokenizer(original)
        manifest = {name:(len(body),hashlib.sha256(body).hexdigest()) for name,body in bodies.items()}
        a, raw = self.wheel()
        pip, bootstrap = self.wheel('pip')
        # Validate the real lock first, preserving its full target and exact bytes;
        # replace dependency records/roots with small local fixtures for assembly.
        actual_lock = self.p.read_lock()
        lock_body = self.p.LOCK.read_bytes()
        self.assertEqual(set(actual_lock['target'])-set(self.v.TARGET),
                         {'extra','platform_release','platform_version'})
        lock = dict(actual_lock,wheels=[a,pip],roots=['demo'])
        streams = {a['url']:raw,pip['url']:bootstrap}
        prefix = f'https://huggingface.co/{self.p.MODEL_REPOSITORY}/resolve/{self.p.MODEL_REVISION}/'
        streams.update({prefix+name:(original if name=='tokenizer/tokenizer_config.json' else body) for name,body in bodies.items()})
        output = self.root/'complete'
        with patch.object(self.p,'read_lock',return_value=lock), patch.object(self.p,'MANIFEST',manifest), patch.object(self.p._artifacts,'MANIFEST',manifest):
            self.p.prepare(output,opener=lambda url:io.BytesIO(streams[url]))
            self.assertFalse((output/'INCOMPLETE').exists())
            self.assertTrue((output/'bootstrap'/pip['filename']).is_file())
            self.assertEqual((output/'requirements.txt').read_text(),f"demo==1.0 --hash=sha256:{a['sha256']}\n")
            self.p.verify_artifacts(output/'model')
            metadata = json.loads((output/'package.json').read_bytes())
            self.assertEqual(metadata['runtime_sources']['server.py']['sha256'],hashlib.sha256((HERE.parent/'server.py').read_bytes()).hexdigest())
            self.assertEqual(len(metadata['runtime_sources']),4)
            for name in ('entrypoint.py','render.py','probe.py','docmee-laya.service.in','docmee-laya.socket.in'):
                self.assertTrue((output/'isolation'/name).is_file(),'isolation asset omitted')
                self.assertEqual((output/'isolation'/name).read_bytes(), (HERE.parent/'isolation'/name).read_bytes())
            self.assertEqual(len(list((output/'model').rglob('*'))),7)
            import release_inventory
            inventory_body = (output/'release-inventory.json').read_bytes()
            inventory = release_inventory.verify_release(output,hashlib.sha256(inventory_body).hexdigest())
            self.assertEqual(inventory['target'],self.v.TARGET)
            self.assertEqual((output/'arm64-cp312.lock.json').read_bytes(),lock_body)
            self.assertEqual(inventory['lock']['sha256'],hashlib.sha256(lock_body).hexdigest())
            self.assertEqual(metadata['target'],actual_lock['target'])
            with self.assertRaisesRegex(ValueError,'wrong target'):
                release_inventory.inventory_bytes(dict(inventory,target=actual_lock['target']))
            self.assertEqual(inventory['source_baseline_commit'],'6317f8ecf4b75b5fb5923093d3a987289ea0fd21')
            self.assertEqual(inventory['runtime_origin_commit'],'d17cd150b11d9ed3efa91ac74d9a0a5dc312f44d')
            expected = {'runtime/'+n for n in ('artifacts.py','backend.py','protocol.py','server.py')}
            expected.update('isolation/'+n for n in ('entrypoint.py','render.py','probe.py','docmee-laya.service.in','docmee-laya.socket.in'))
            expected.update('model/'+n for n in bodies)
            expected.update(('wheels/'+a['filename'],'bootstrap/'+pip['filename'],
                             'requirements.txt','arm64-cp312.lock.json','package.json'))
            self.assertEqual({r['path'] for r in inventory['files']},expected)
            second = self.root/'second'
            self.p.prepare(second,opener=lambda url:io.BytesIO(streams[url]))
            self.assertEqual((second/'release-inventory.json').read_bytes(),inventory_body)
            for injected in ('unexpected-file','unexpected-dir'):
                extra = self.root/injected
                def inject(url):
                    if url == a['url']:
                        (extra/'unexpected').mkdir() if injected.endswith('dir') else (extra/'unexpected').write_bytes(b'x')
                    return io.BytesIO(streams[url])
                with self.assertRaises(ValueError):
                    self.p.prepare(extra,opener=inject)
                self.assertTrue((extra/'INCOMPLETE').is_file())
                self.assertFalse((extra/'release-inventory.json').exists())
            bad = self.root/'extra-model-file'
            def injected_extra(url):
                if url == prefix+'tokenizer/tokenizer_config.json':
                    (bad/'model'/'extra').write_bytes(b'x')
                return io.BytesIO(streams[url])
            with self.assertRaises(ValueError):
                self.p.prepare(bad,opener=injected_extra)
            self.assertTrue((bad/'INCOMPLETE').is_file())
            self.assertFalse((bad/'package.json').exists())


if __name__ == '__main__':
    unittest.main()
