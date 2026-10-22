"""Synthetic sockets; Linux covers both exec inheritance and in-process adoption."""
import contextlib
from pathlib import Path
import socket
import subprocess
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import server


class ActivationTests(unittest.TestCase):
    def test_activation_api_exists(self):
        self.assertTrue(callable(getattr(server, "adopt_systemd_socket", None)),
                        "missing fail-closed socket activation")

    def test_non_linux_activation_fails_before_backend_load(self):
        self.assertTrue(hasattr(server, "adopt_systemd_socket"), "missing activation startup")
        with patch.object(sys, "platform", "win32"), patch.object(
                sys, "argv", ["server.py", "--systemd-socket", "--artifact-dir", "invalid"]):
            with contextlib.redirect_stderr(__import__('io').StringIO()) as output:
                self.assertEqual(server.main(), 1)
            self.assertEqual(output.getvalue(), "activation unavailable\n")

    def test_real_listener_rejects_wrong_port_and_nonlisteners(self):
        self.assertTrue(hasattr(server, "validate_activation_socket"), "missing listener validation")
        for kind, listening in ((socket.SOCK_STREAM, True), (socket.SOCK_STREAM, False),
                                (socket.SOCK_DGRAM, False)):
            with self.subTest(kind=kind, listening=listening), socket.socket(type=kind) as sock:
                sock.bind(("127.0.0.1", 0))
                if listening:
                    sock.listen(8)
                with self.assertRaises(ValueError):
                    server.validate_activation_socket(sock)

    def test_transferred_listener_is_closed_if_constructor_validation_fails(self):
        listener = socket.socket()
        with self.assertRaises(ValueError):
            server.RuntimeServer(("127.0.0.1", 0), listener=listener, max_workers=1)
        self.assertEqual(listener.fileno(), -1)

    def test_connected_stream_cannot_be_adopted_as_listener(self):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            listener.listen(8)
            with socket.create_connection(listener.getsockname()) as client:
                connection, _ = listener.accept()
                with connection, self.assertRaises(ValueError):
                    server.validate_activation_socket(connection)

    def test_backend_base_exception_does_not_leak_owned_listener(self):
        listener = socket.socket()
        timer = SimpleNamespace(SIGALRM=14, SIG_DFL=0, ITIMER_REAL=0,
                                signal=lambda *_: None, setitimer=lambda *_: None)
        def interrupted(_path):
            raise SystemExit(1)
        with patch.object(server, "signal", timer), patch.object(
                server, "adopt_systemd_socket", return_value=listener), patch.dict(
                sys.modules, {"backend": SimpleNamespace(PinnedBackend=interrupted)}), patch.object(
                sys, "argv", ["server.py", "--systemd-socket", "--artifact-dir", "synthetic"]):
            with self.assertRaises(SystemExit):
                server.main()
        try:
            self.assertEqual(listener.fileno(), -1)
        finally:
            listener.close()

    def test_socket_startup_deadline_spans_backend_and_server_init_only(self):
        # Windows has no SIGALRM. This narrow API double tests orchestration;
        # the Linux subprocess below tests actual kernel termination semantics.
        timer = SimpleNamespace(active=False, SIGALRM=14, SIG_DFL=0, ITIMER_REAL=0)
        def handler(kind, action):
            self.assertEqual((kind, action), (14, 0))
        def arm(kind, seconds):
            self.assertEqual(kind, 0)
            self.assertIn(seconds, (0, 60))
            timer.active = seconds != 0
        timer.signal, timer.setitimer = handler, arm
        def backend(_path):
            self.assertTrue(timer.active, "backend initialized without kernel deadline")
            return object()
        class Runtime:
            def __init__(inner, *args, **kwargs):
                self.assertTrue(timer.active, "server initialized without startup deadline")
            def __enter__(inner):
                return inner
            def __exit__(inner, *args):
                pass
            def serve_forever(inner, **kwargs):
                self.assertFalse(timer.active, "startup timer leaked into steady state")
        listener = socket.socket()
        with patch.object(server, "signal", timer, create=True), patch.object(
                server, "adopt_systemd_socket", return_value=listener), patch.object(
                server, "RuntimeServer", Runtime), patch.dict(
                sys.modules, {"backend": SimpleNamespace(PinnedBackend=backend)}), patch.object(
                sys, "argv", ["server.py", "--systemd-socket", "--artifact-dir", "synthetic"]):
            self.assertEqual(server.main(), 0)
        self.assertEqual(listener.fileno(), -1)
        self.assertFalse(timer.active)

    @unittest.skipUnless(sys.platform == "linux", "requires Linux SIGALRM default action")
    def test_actual_kernel_deadline_kills_hung_synthetic_startup(self):
        import signal
        program = r'''
import os, socket, sys, time, types
sys.path.insert(0,sys.argv[1])
import server
sock=socket.socket()
sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
sock.bind(('127.0.0.1',8767)); sock.listen(8)
if sock.fileno()!=3:
    os.dup2(sock.fileno(),3); sock.close()
else: sock.detach()
os.environ.update(LISTEN_PID=str(os.getpid()),LISTEN_FDS='1')
def hung(_path): time.sleep(10)
sys.modules['backend']=types.SimpleNamespace(PinnedBackend=hung)
server.STARTUP_TIMEOUT_SECONDS=0.15  # Test-only; no CLI/env override exists.
sys.argv=['server.py','--systemd-socket','--artifact-dir','synthetic']
server.main()
raise AssertionError('hung startup escaped kernel deadline')
'''
        result = subprocess.run([sys.executable, "-I", "-B", "-c", program, str(ROOT)],
                                capture_output=True, timeout=3)
        self.assertEqual(result.returncode, -signal.SIGALRM, result.stderr.decode())
        self.assertEqual(result.stdout + result.stderr, b"")

    def test_ordinary_server_lifecycle_still_binds_closes_and_serves_health(self):
        with server.RuntimeServer(("127.0.0.1", 0)) as runtime:
            thread = threading.Thread(target=runtime.serve_forever,
                                      kwargs={"poll_interval": 0.01})
            thread.start()
            try:
                with socket.create_connection(runtime.server_address, timeout=2) as client:
                    client.sendall(b"GET /health HTTP/1.1\r\nHost: synthetic\r\n\r\n")
                    self.assertIn(b"200 OK", client.recv(4096))
            finally:
                runtime.shutdown()
                thread.join(1)
        self.assertEqual(runtime.socket.fileno(), -1)

    @unittest.skipUnless(sys.platform == "linux", "requires actual Linux exec fd inheritance")
    def test_exec_inherited_fd3_http_closure_and_cloexec_rejection(self):
        # The launcher, not the target interpreter, creates the activation fd.
        # Exec keeps the PID, so metadata describes the actual target process.
        target = r'''
import errno, os, socket, sys, threading
case = sys.argv[2]
assert os.getpid() == int(sys.argv[3])
assert os.environ['LISTEN_PID'] == str(os.getpid())
assert os.environ['LISTEN_FDS'] == '1'
assert os.environ['LISTEN_FDNAMES'] == 'docmee-laya'
if case == 'cloexec':
    try: os.fstat(3)
    except OSError as error: assert error.errno == errno.EBADF
    else: raise AssertionError('non-inherited descriptor survived exec')
else:
    os.fstat(3)  # Must already exist before importing/adopting in the target.
    assert os.get_inheritable(3)
sys.path.insert(0, sys.argv[1])
import server
if case == 'cloexec':
    try: server.adopt_systemd_socket()
    except ValueError: pass
    else: raise AssertionError('missing inherited fd was accepted')
    assert not any(name in os.environ for name in ('LISTEN_PID','LISTEN_FDS','LISTEN_FDNAMES'))
else:
    listener = server.adopt_systemd_socket()
    assert listener.fileno() == 3 and not os.get_inheritable(3)
    with server.RuntimeServer(('127.0.0.1',8767), listener=listener) as runtime:
        thread = threading.Thread(target=runtime.serve_forever, kwargs={'poll_interval':0.01})
        thread.start()
        try:
            with socket.create_connection(('127.0.0.1',8767),timeout=2) as client:
                client.sendall(b'GET /health HTTP/1.1\r\nHost: synthetic\r\n\r\n')
                response = bytearray()
                while True:
                    chunk = client.recv(4096)
                    if not chunk: break
                    response.extend(chunk)
                assert b'200 OK' in response and response.endswith(b'{"status":"alive"}')
        finally:
            runtime.shutdown(); thread.join(1)
    assert listener.fileno() == -1
try: os.fstat(3)
except OSError as error: assert error.errno == errno.EBADF
else: raise AssertionError('owned activation descriptor leaked')
'''
        launcher = r'''
import os, socket, sys
root, case, target = sys.argv[1:]
sock = socket.socket()
sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
sock.bind(('127.0.0.1',8767)); sock.listen(8)
if sock.fileno() != 3:
    os.dup2(sock.fileno(),3); sock.close()
else: sock.detach()
os.set_inheritable(3,case == 'inherited')
environment = os.environ.copy()
environment.update(LISTEN_PID=str(os.getpid()),LISTEN_FDS='1',LISTEN_FDNAMES='docmee-laya')
os.execve(sys.executable,[sys.executable,'-I','-B','-c',target,root,case,str(os.getpid())],environment)
'''
        for case in ("inherited", "cloexec"):
            with self.subTest(case=case):
                result = subprocess.run([sys.executable, "-I", "-B", "-c", launcher,
                                         str(ROOT), case, target], capture_output=True, timeout=8)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                self.assertEqual(result.stdout + result.stderr, b"")

    @unittest.skipUnless(sys.platform == "linux", "requires Linux fd 3 adoption")
    def test_in_process_fd3_validation_cleanup_and_http_lifecycle(self):
        # No model, network namespace, privileges or external traffic involved.
        program = r'''
import contextlib, io, os, socket, sys, threading, types
sys.path.insert(0, sys.argv[1])
import server
case = sys.argv[2]
family = socket.AF_INET6 if case == 'family' else socket.AF_INET
kind = socket.SOCK_DGRAM if case == 'datagram' else socket.SOCK_STREAM
sock = socket.socket(family, kind)
if kind == socket.SOCK_STREAM:
    sock.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
host = '::1' if case == 'family' else ('0.0.0.0' if case == 'address' else '127.0.0.1')
sock.bind((host, 0 if case == 'port' else 8767))
if kind == socket.SOCK_STREAM and case != 'not-listening': sock.listen(8)
if sock.fileno() != 3:
    os.dup2(sock.fileno(), 3)
    sock.close()
else: sock.detach()
os.environ.update(LISTEN_PID=str(os.getpid()), LISTEN_FDS='1', LISTEN_FDNAMES='docmee-laya')
changes = {'pid': ('LISTEN_PID', str(os.getpid()+1)), 'fds': ('LISTEN_FDS','2'),
           'zero': ('LISTEN_FDS','0'), 'malformed': ('LISTEN_FDS','+1'),
           'name': ('LISTEN_FDNAMES','other'), 'names': ('LISTEN_FDNAMES','docmee-laya:other'),
           'bad-pid': ('LISTEN_PID',' 1'), 'empty': ('LISTEN_FDNAMES','')}
if case in changes: os.environ[changes[case][0]] = changes[case][1]
if case == 'missing': os.environ.pop('LISTEN_PID')
if case == 'unnamed': os.environ.pop('LISTEN_FDNAMES')
if case == 'closed': os.close(3)
if case == 'pipe':
    read_fd, write_fd = os.pipe()
    os.dup2(read_fd,3)
    os.close(read_fd); os.close(write_fd)
if case == 'fds':
    # Reject extra descriptors before even constructing a synthetic backend.
    # Only fd 3 is owned by the helper; extras die with this failing CLI process.
    extra_fd = os.dup(3)
    loaded = []
    sys.modules['backend'] = types.SimpleNamespace(PinnedBackend=lambda _: loaded.append(True))
    sys.argv = ['server.py','--systemd-socket','--artifact-dir','synthetic']
    with contextlib.redirect_stderr(io.StringIO()) as output:
        assert server.main() == 1
    assert output.getvalue() == 'activation unavailable\n' and not loaded
    try: os.fstat(3)
    except OSError: pass
    else: raise AssertionError('owned fd leaked')
    os.fstat(extra_fd)  # No scanning or guessed closure of unrelated descriptors.
    raise SystemExit(0)
try:
    listener = server.adopt_systemd_socket()
except ValueError:
    assert case not in ('valid','unnamed'), case
    try: os.fstat(3)
    except OSError: pass
    else: raise AssertionError('fd 3 leaked on failure')
else:
    assert case in ('valid','unnamed'), case
    assert listener.fileno() == 3
    assert not os.get_inheritable(3)
    with server.RuntimeServer(('127.0.0.1',8767), listener=listener) as runtime:
        thread=threading.Thread(target=runtime.serve_forever, kwargs={'poll_interval':0.01})
        thread.start()
        try:
            with socket.create_connection(('127.0.0.1',8767),timeout=2) as client:
                client.sendall(b'GET /health HTTP/1.1\r\nHost: synthetic\r\n\r\n')
                assert b'200 OK' in client.recv(4096)
        finally:
            runtime.shutdown(); thread.join(1)
    assert listener.fileno() == -1
'''
        for case in ("valid", "unnamed", "pid", "fds", "zero", "malformed", "name", "names",
                     "bad-pid", "empty", "missing", "closed", "address", "port", "family",
                     "datagram", "not-listening", "pipe"):
            with self.subTest(case=case):
                result = subprocess.run([sys.executable, "-I", "-B", "-c", program, str(ROOT), case],
                                        capture_output=True, timeout=8)
                self.assertEqual(result.returncode, 0, result.stderr.decode())


if __name__ == "__main__":
    unittest.main()
