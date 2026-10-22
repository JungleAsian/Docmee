"""Renderer contract and synthetic probe-output tests, not sandbox evidence."""
import contextlib
import errno
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((HERE / "render.py").is_file(), "missing fail-closed unit renderer")
        self.render = load("render")

    def test_safe_release_renders_fixed_socket_and_sandbox(self):
        units = self.render.render_units("/opt/docmee-laya/releases/release-20261021-a")
        self.assertEqual(set(units), {"docmee-laya.socket", "docmee-laya.service"})
        socket = units["docmee-laya.socket"]
        service = units["docmee-laya.service"]
        # Parse the consumed INI fields, including repeated syscall filters.
        def fields(text):
            result = {}
            for line in text.splitlines():
                if "=" in line:
                    key, value = line.split("=", 1)
                    result.setdefault(key, []).append(value)
            return result
        sock = fields(socket)
        svc = fields(service)
        self.assertEqual(sock["ListenStream"], ["127.0.0.1:8767"])
        self.assertEqual(sock["Backlog"], ["8"])
        self.assertEqual(sock["ReusePort"], ["no"])
        self.assertEqual(sock["FileDescriptorName"], ["docmee-laya"])
        expected = {"PrivateNetwork": "yes", "DynamicUser": "yes", "NoNewPrivileges": "yes",
                    "ProtectSystem": "strict", "ProtectHome": "yes", "PrivateTmp": "yes",
                    "PrivateDevices": "yes", "CapabilityBoundingSet": "", "AmbientCapabilities": "",
                    "SystemCallArchitectures": "native", "StandardOutput": "null", "StandardError": "null",
                    "LimitCORE": "0", "CPUQuota": "100%", "MemoryMax": "3G", "TasksMax": "16",
                    "LimitNOFILE": "64", "TimeoutStartSec": "60s", "TimeoutStopSec": "5s",
                    "RestartSec": "5s", "StartLimitBurst": "3", "StartLimitIntervalSec": "300s",
                    "Requires": "docmee-laya.socket", "After": "docmee-laya.socket",
                    "RestrictAddressFamilies": "AF_INET"}
        for key, value in expected.items():
            self.assertEqual(svc.get(key), [value], key)
        self.assertEqual(svc["SystemCallFilter"][0], "@system-service")
        self.assertIn("connect", svc["SystemCallFilter"][1])
        self.assertIn("@mount", svc["SystemCallFilter"][1])
        self.assertIn("io_uring_setup", svc["SystemCallFilter"][1])
        self.assertEqual(svc["ExecStart"], ["/opt/docmee-laya/releases/release-20261021-a/venv/bin/python -I -B /opt/docmee-laya/releases/release-20261021-a/isolation/entrypoint.py"])
        for key in ("EnvironmentFile", "LoadCredential", "ExecStartPre", "ExecStartPost",
                    "BindPaths", "ReadWritePaths", "ProcSubset", "MemoryDenyWriteExecute"):
            self.assertNotIn(key, svc)
        self.assertNotIn("@RELEASE@", service)

    def test_paths_and_unit_injection_fail_closed(self):
        for value in ("/opt/docmee-laya/releases", "/opt/docmee-laya/releases/current",
                      "/opt/docmee-laya/releases/../evil", "/opt/docmee-laya/releases/a/b",
                      "/opt/docmee-laya/releases/a b", "/opt/docmee-laya/releases/a\nExecStart=/evil",
                      "/opt/docmee-laya/releases/%i", "/opt/docmee-laya/releases/$x",
                      "/opt/docmee-laya/releases/a..b", "/other/releases/a", "relative",
                      "/opt/docmee-laya/releases/a/", "/opt//docmee-laya/releases/a"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.render.render_units(value)

    def test_template_mutation_is_rejected_not_silently_rendered(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            for path in HERE.glob("*.in"):
                (target / path.name).write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
            service = target / "docmee-laya.service.in"
            service.write_text(service.read_text(encoding="utf-8").replace("PrivateNetwork=yes", "PrivateNetwork=no"), encoding="utf-8")
            with patch.object(self.render, "HERE", target), self.assertRaises(ValueError):
                self.render.render_units("/opt/docmee-laya/releases/test-a")

    def test_host_dns_path_is_not_readable_in_rendered_policy(self):
        service = self.render.render_units("/opt/docmee-laya/releases/test-a")["docmee-laya.service"]
        policy = next(line for line in service.splitlines() if line.startswith("InaccessiblePaths="))
        self.assertIn("-/etc/resolv.conf", policy.split())
        self.assertIn("-/run/systemd/resolve", policy.split())

    def test_entry_rejects_mutable_checkout_even_with_isolated_flags(self):
        result = subprocess.run([sys.executable, "-I", "-B", str(HERE / "entrypoint.py")],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout + result.stderr, "")

    def test_entry_rejects_missing_isolated_flags(self):
        result = subprocess.run([sys.executable, str(HERE / "entrypoint.py")],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout + result.stderr, "")

    def test_cli_invalid_path_prints_only_categorical_failure(self):
        result = subprocess.run([sys.executable, str(HERE / "render.py"), "--release", "bad"],
                                capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr, "render:FAIL\n")

    def test_probe_non_linux_is_categorical_and_nonzero(self):
        self.assertTrue((HERE / "probe.py").is_file(), "missing synthetic isolation probe")
        probe = load("probe")
        with patch.object(sys, "platform", "win32"), contextlib.redirect_stdout(io.StringIO()) as output:
            self.assertEqual(probe.main(), 1)
        self.assertEqual(output.getvalue(), "platform:FAIL\n")

    def test_probe_formats_only_fixed_categories(self):
        self.assertTrue((HERE / "probe.py").is_file(), "missing synthetic isolation probe")
        probe = load("probe")
        for values, status in (({"identity": True, "release": True}, 0),
                               ({"identity": False, "release": True}, 1)):
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(probe.emit_results(values), status)
            self.assertRegex(output.getvalue(), r"\Aidentity:(PASS|FAIL)\nrelease:PASS\n\Z")

    def test_probe_does_not_mistake_refusal_or_timeout_for_enforcement(self):
        probe = load("probe")
        for error, expected in ((PermissionError(errno.EPERM, "synthetic"), True),
                                (ConnectionRefusedError(errno.ECONNREFUSED, "synthetic"), False),
                                (TimeoutError("synthetic"), False)):
            with self.subTest(error=type(error).__name__), patch.object(
                    probe.socket, "socket", side_effect=error):
                self.assertEqual(probe.blocked_network("192.0.2.1", 9), expected)

    @unittest.skipUnless(sys.platform == "linux", "requires Linux open flags")
    def test_probe_read_and_write_checks_never_change_or_read_canary_content(self):
        probe = load("probe")
        with tempfile.TemporaryDirectory() as directory:
            canary = Path(directory) / "synthetic"
            canary.write_bytes(b"synthetic canary")
            self.assertFalse(probe.inaccessible_canary(canary))
            self.assertFalse(probe.release_readonly(canary))
            self.assertEqual(canary.read_bytes(), b"synthetic canary")
            self.assertFalse(probe.release_readonly(Path(directory) / "missing"))

    @unittest.skipUnless(sys.platform == "linux", "requires Linux release symlink semantics")
    def test_linux_release_ancestor_symlink_is_rejected(self):
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "real").mkdir()
            (root / "link").symlink_to(root / "real", target_is_directory=True)
            with self.assertRaises(ValueError):
                self.render.reject_symlink_ancestors(root / "link" / "release")


if __name__ == "__main__":
    unittest.main()
