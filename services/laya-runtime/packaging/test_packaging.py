"""Small real filesystem/ZIP fixtures; no network or downloaded code execution."""
import hashlib
import io
import json
from pathlib import Path
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
        good = ('cp312-cp312-manylinux_2_28_aarch64', 'cp310-abi3-manylinux2014_aarch64', 'py3-none-any')
        bad = ('cp311-cp311-manylinux_2_28_aarch64', 'cp313-abi3-manylinux_2_28_aarch64',
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

    def test_tokenizer_original_and_prepared_hashes(self):
        original = b'{\n  "bos_token": "<bos>",\n  "clean_up_tokenization_spaces": false,\n  "cls_token": "<bos>",\n  "eos_token": "<eos>",\n  "extra_special_tokens": [\n    "<start_of_turn>",\n    "<end_of_turn>"\n  ],\n  "mask_token": "<mask>",\n  "model_input_names": [\n    "input_ids",\n    "attention_mask"\n  ],\n  "model_max_length": 8192,\n  "pad_token": "<pad>",\n  "padding_side": "right",\n  "sep_token": "<eos>",\n  "spaces_between_special_tokens": false,\n  "tokenizer_class": "PreTrainedTokenizerFast",\n  "unk_token": "<unk>"\n}'
        result = self.p.normalize_tokenizer(original)
        self.assertEqual(len(result),524)
        self.assertEqual(hashlib.sha256(result).hexdigest(),'6c6b2d8e3c84ce0e671c129cd6b374b235d6f9863042a5836358d00a89bbb5a1')
        self.assertEqual(json.loads(result)['extra_special_tokens'],{'extra_0':'<start_of_turn>','extra_1':'<end_of_turn>'})
        with self.assertRaises(ValueError):
            self.p.normalize_tokenizer(original+b'\n')

    def test_model_tree_uses_production_closed_verifier(self):
        import artifacts
        model = self.root / 'model'
        model.mkdir()
        (model / 'config.json').write_bytes(b'{}')
        manifest = {'config.json':(2,hashlib.sha256(b'{}').hexdigest())}
        with patch.object(artifacts,'MANIFEST',manifest):
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
        import artifacts
        original = b'{\n  "bos_token": "<bos>",\n  "clean_up_tokenization_spaces": false,\n  "cls_token": "<bos>",\n  "eos_token": "<eos>",\n  "extra_special_tokens": [\n    "<start_of_turn>",\n    "<end_of_turn>"\n  ],\n  "mask_token": "<mask>",\n  "model_input_names": [\n    "input_ids",\n    "attention_mask"\n  ],\n  "model_max_length": 8192,\n  "pad_token": "<pad>",\n  "padding_side": "right",\n  "sep_token": "<eos>",\n  "spaces_between_special_tokens": false,\n  "tokenizer_class": "PreTrainedTokenizerFast",\n  "unk_token": "<unk>"\n}'
        bodies = {name:b'fixture' for name in artifacts.MANIFEST}
        bodies['tokenizer/tokenizer_config.json'] = self.p.normalize_tokenizer(original)
        manifest = {name:(len(body),hashlib.sha256(body).hexdigest()) for name,body in bodies.items()}
        a, raw = self.wheel()
        pip, bootstrap = self.wheel('pip')
        lock = dict(wheels=[a,pip],roots=['demo'],bootstrap='pip',target=self.v.TARGET)
        lockfile = self.root/'fixture.lock.json'
        lockfile.write_text(json.dumps(lock))
        streams = {a['url']:raw,pip['url']:bootstrap}
        prefix = f'https://huggingface.co/{artifacts.MODEL_REPOSITORY}/resolve/{artifacts.MODEL_REVISION}/'
        streams.update({prefix+name:(original if name=='tokenizer/tokenizer_config.json' else body) for name,body in bodies.items()})
        output = self.root/'complete'
        with patch.object(self.p,'read_lock',return_value=lock), patch.object(self.p,'LOCK',lockfile), patch.object(self.p,'MANIFEST',manifest), patch.object(artifacts,'MANIFEST',manifest):
            self.p.prepare(output,opener=lambda url:io.BytesIO(streams[url]))
            self.assertFalse((output/'INCOMPLETE').exists())
            self.assertTrue((output/'bootstrap'/pip['filename']).is_file())
            self.assertEqual((output/'requirements.txt').read_text(),f"demo==1.0 --hash=sha256:{a['sha256']}\n")
            self.p.verify_artifacts(output/'model')
            metadata = json.loads((output/'package.json').read_bytes())
            self.assertEqual(metadata['runtime_sources']['server.py']['sha256'],hashlib.sha256((HERE.parent/'server.py').read_bytes()).hexdigest())
            self.assertEqual(len(metadata['runtime_sources']),4)
            self.assertEqual(len(list((output/'model').rglob('*'))),7)
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
