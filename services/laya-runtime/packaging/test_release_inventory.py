"""Read-only integrity boundary with tiny local packages, never model execution."""
import hashlib
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((HERE/'release_inventory.py').is_file(), 'release inventory verifier missing')
        import release_inventory
        self.v = release_inventory
        self.temp = tempfile.TemporaryDirectory(prefix='laya-inventory-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)/'package'
        (self.root/'runtime').mkdir(parents=True)
        (self.root/'runtime'/'server.py').write_bytes(b'abc')
        self.data = {
            'schema_version':1, 'source_baseline_commit':'6'*40, 'runtime_origin_commit':'d'*40,
            'target':{'implementation_name':'cpython','implementation_version':'3.12.0',
                      'os_name':'posix','platform_machine':'aarch64','platform_python_implementation':'CPython',
                      'platform_system':'Linux','python_full_version':'3.12.0','python_version':'3.12','sys_platform':'linux'},
            'model':{'repository':'convaiinnovations/laya-multilingual','revision':'e'*40},
            'lock':{'filename':'arm64-cp312.lock.json','sha256':'0'*64},
            'files':[{'path':'runtime/server.py','size':3,
                      'sha256':'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'}],
        }
        self.seal()

    def seal(self, raw=None):
        raw = json.dumps(self.data,sort_keys=True,separators=(',',':')).encode()+b'\n' if raw is None else raw
        (self.root/'release-inventory.json').write_bytes(raw)
        self.digest = hashlib.sha256(raw).hexdigest()

    def test_valid_package_is_verified_without_any_file_writes(self):
        before = {p.relative_to(self.root).as_posix():(p.read_bytes(),p.stat().st_mtime_ns)
                  for p in self.root.rglob('*') if p.is_file()}
        self.v.verify_release(self.root,self.digest)
        after = {p.relative_to(self.root).as_posix():(p.read_bytes(),p.stat().st_mtime_ns)
                 for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before,after)

    def test_missing_extra_files_and_unexpected_empty_directory_fail(self):
        for name, directory in [('extra',False),('extra-dir',True),('runtime/unexpected',True)]:
            path = self.root/name
            path.mkdir() if directory else path.write_bytes(b'x')
            with self.subTest(name=name),self.assertRaises(ValueError):
                self.v.verify_release(self.root,self.digest)
            path.rmdir() if directory else path.unlink()
        (self.root/'runtime'/'server.py').unlink()
        with self.assertRaises(ValueError):
            self.v.verify_release(self.root,self.digest)

    def test_size_and_same_size_hash_tampering_fail(self):
        for body in (b'ab',b'abcd',b'xyz'):
            (self.root/'runtime'/'server.py').write_bytes(body)
            with self.subTest(body=body),self.assertRaises(ValueError):
                self.v.verify_release(self.root,self.digest)

    def test_out_of_band_digest_required_and_checked_before_json_parsing(self):
        self.seal(b'not json')
        with patch.object(self.v.json,'loads',side_effect=AssertionError('parsed before digest')):
            for digest in ('','0'*64,None,'A'*64):
                with self.subTest(digest=digest),self.assertRaises(ValueError):
                    self.v.verify_release(self.root,digest)
        with self.assertRaises(ValueError):
            self.v.verify_release(self.root,self.digest)

    def test_duplicate_keys_and_nonfinite_values_fail_even_with_matching_digest(self):
        for raw in (b'{"schema_version":1,"schema_version":1}',b'{"size":NaN}',b'{}',b'[]',b'\xff'):
            self.seal(raw)
            with self.subTest(raw=raw),self.assertRaises(ValueError):
                self.v.verify_release(self.root,self.digest)

    def test_exact_schema_and_field_types(self):
        import copy
        original = copy.deepcopy(self.data)
        for key,value in [('unexpected',0),('schema_version',True),('schema_version',2),
                          ('source_baseline_commit','../bad'),('target',{}),('model',{'revision':'e'*40}),
                          ('lock',{'filename':'../lock','sha256':'0'*64})]:
            self.data = copy.deepcopy(original)
            self.data[key] = value
            self.seal()
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):
                self.v.verify_release(self.root,self.digest)
        for key,value in [('size',True),('size',-1),('size',2**50),('sha256','A'*64),('extra',0)]:
            self.data = copy.deepcopy(original)
            self.data['files'][0][key] = value
            self.seal()
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):
                self.v.verify_release(self.root,self.digest)

    def test_unsafe_relative_paths_and_aliases_fail(self):
        for path in ('/absolute','../escape','runtime/../escape','runtime//server.py','runtime/./server.py',
                     'runtime\\server.py','C:/escape','runtime/CON','runtime/nul.txt','runtime/trailing.',
                     'runtime/trailing ','runtime/a\n','runtime/a:stream','release-inventory.json','INCOMPLETE',
                     'incomplete/x','release-inventory.json/x','RELEASE-INVENTORY.JSON',''):
            self.data['files'][0]['path'] = path
            self.seal()
            with self.subTest(path=path),self.assertRaises(ValueError):
                self.v.verify_release(self.root,self.digest)

    def test_incomplete_directory_cannot_be_an_allowed_ancestor(self):
        (self.root/'INCOMPLETE').mkdir()
        (self.root/'INCOMPLETE'/'x').write_bytes(b'abc')
        self.data['files'].append(dict(self.data['files'][0],path='INCOMPLETE/x'))
        self.seal()
        with self.assertRaises(ValueError):
            self.v.verify_release(self.root,self.digest)

    def test_duplicate_and_file_directory_collisions_fail(self):
        self.data['files'].append(dict(self.data['files'][0]))
        self.seal()
        with self.assertRaises(ValueError):
            self.v.verify_release(self.root,self.digest)
        self.data['files'][1]['path'] = 'runtime'
        self.seal()
        with self.assertRaises(ValueError):
            self.v.verify_release(self.root,self.digest)

    def test_incomplete_marker_fails_even_if_in_inventory(self):
        (self.root/'INCOMPLETE').write_bytes(b'')
        with self.assertRaises(ValueError):
            self.v.verify_release(self.root,self.digest)

    def test_bounded_inventory_and_relative_root_fail(self):
        self.seal(b' '* (1024*1024+1))
        with self.assertRaises(ValueError):
            self.v.verify_release(self.root,self.digest)
        with self.assertRaises(ValueError):
            self.v.verify_release(Path('relative'),self.digest)

    def test_symlink_reparse_and_nonregular_objects_fail(self):
        for mode,attrs in [(stat.S_IFLNK,0),(stat.S_IFDIR,0x400),(stat.S_IFIFO,0)]:
            fake = SimpleNamespace(st_mode=mode,st_file_attributes=attrs)
            with patch.object(Path,'lstat',return_value=fake),self.assertRaises(ValueError):
                self.v.verify_release(self.root,self.digest)

    def test_real_file_directory_and_inventory_symlinks_fail(self):
        target = Path(self.temp.name)/'outside'
        target.write_bytes(b'abc')
        probe = Path(self.temp.name)/'probe'
        try:
            probe.symlink_to(target)
        except OSError:
            self.skipTest('Windows user lacks symlink privilege')
        probe.unlink()
        for relative in ('runtime/server.py','release-inventory.json'):
            path = self.root/relative
            body = path.read_bytes()
            path.unlink()
            path.symlink_to(target)
            with self.subTest(relative=relative),self.assertRaises(ValueError):
                self.v.verify_release(self.root,self.digest)
            path.unlink()
            path.write_bytes(body)
        (self.root/'extra-dir').symlink_to(self.root/'runtime',target_is_directory=True)
        with self.assertRaises(ValueError):
            self.v.verify_release(self.root,self.digest)

    def test_inventory_serialization_is_deterministic_without_self_hash(self):
        one = self.v.inventory_bytes(self.data)
        two = self.v.inventory_bytes(dict(reversed(list(self.data.items()))))
        self.assertEqual(one,two)
        self.assertNotIn(b'release-inventory.json',one)
        self.seal(one)
        self.v.verify_release(self.root,self.digest)

    def test_cli_requires_digest_and_does_not_import_runtime(self):
        for args,code in [([],2),(['--inventory-sha256',self.digest],0),
                          (['--inventory-sha256','0'*64],1)]:
            result = subprocess.run([sys.executable,'-I','-B',str(HERE/'release_inventory.py'),
                                     'verify',str(self.root),*args],capture_output=True,timeout=10)
            self.assertEqual(result.returncode,code,result.stderr)
        # Deliberately invalid Python in the payload is only hashed, never imported.
        (self.root/'runtime'/'server.py').write_bytes(b'abc')
        self.assertFalse((self.root/'runtime'/'__pycache__').exists())


if __name__ == '__main__':
    unittest.main()
