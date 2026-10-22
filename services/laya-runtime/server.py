"""Loopback-only, bounded HTTP boundary. No backend is installed by this module."""
import argparse
import math
import os
import re
import signal
import socket
import socketserver
import threading
import time
import sys
from typing import Protocol

from protocol import Invalid, encode_response, parse_request

MAX_HEADERS = 32
MAX_HEADER_BYTES = 8192
MAX_LINE_BYTES = 2048
MAX_BODY_BYTES = 32768
STARTUP_TIMEOUT_SECONDS = 60
ERROR = b'{"error":"unavailable"}'
REASONS = {200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed",
           408: "Request Timeout", 413: "Content Too Large", 415: "Unsupported Media Type",
           431: "Request Header Fields Too Large", 503: "Service Unavailable"}
TOKEN = re.compile(rb"[!#$%&'*+.^_`|~0-9A-Za-z-]+")
MEDIA = re.compile(r'application/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?', re.I)


class Backend(Protocol):
    """Trusted local backend: readiness fields must be nonblocking plain values.

    Implementations must not retain or log requests. Compute may block; the server
    will never queue another inference while that call is unsettled.
    """
    ready: bool
    model_version: str
    calibration_version: str

    def decide(self, request: dict) -> dict: ...


class Rejected(Exception):
    def __init__(self, status):
        self.status = status


def validate_activation_socket(listener):
    """Validate the one fixed host listener; never bind or replace it."""
    if (listener.family != socket.AF_INET
            or listener.getsockopt(socket.SOL_SOCKET, socket.SO_TYPE) != socket.SOCK_STREAM
            or listener.getsockopt(socket.SOL_SOCKET, socket.SO_ACCEPTCONN) != 1
            or listener.getsockname() != ("127.0.0.1", 8767)):
        raise ValueError("invalid activation socket")


def adopt_systemd_socket():
    """Take ownership of fd 3 only, including on invalid activation metadata.

    Activation is an explicit Linux-only process mode. A failed startup exits;
    unrelated descriptors are not scanned, guessed, duplicated or imported.
    """
    if sys.platform != "linux":
        raise ValueError("Linux activation required")
    listener = None
    try:
        if (os.environ.get("LISTEN_PID") != str(os.getpid())
                or os.environ.get("LISTEN_FDS") != "1"
                or os.environ.get("LISTEN_FDNAMES", "docmee-laya") != "docmee-laya"):
            raise ValueError("invalid activation metadata")
        listener = socket.socket(fileno=3)
        validate_activation_socket(listener)
        listener.set_inheritable(False)
        listener.setblocking(True)
        return listener
    except (OSError, ValueError) as error:
        if listener is not None:
            listener.close()
        else:
            try:
                os.close(3)
            except OSError:
                pass
        raise ValueError("invalid activation") from error
    finally:
        for name in ("LISTEN_PID", "LISTEN_FDS", "LISTEN_FDNAMES"):
            os.environ.pop(name, None)


def send(sock, status, body=ERROR):
    header = (f"HTTP/1.1 {status} {REASONS[status]}\r\nContent-Type: application/json\r\n"
              f"Content-Length: {len(body)}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n")
    sock.sendall(header.encode("ascii") + body)
    # Send FIN before closing and discard only a bounded amount of trailing data.
    # Closing with unread data can reset TCP on Windows and erase a generic busy
    # response before the client receives it. Never parse or dispatch these bytes.
    sock.shutdown(socket.SHUT_WR)
    deadline = time.monotonic() + 0.01
    discarded = 0
    while discarded < MAX_BODY_BYTES + MAX_HEADER_BYTES:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        sock.settimeout(remaining)
        try:
            chunk = sock.recv(min(4096, MAX_BODY_BYTES + MAX_HEADER_BYTES - discarded))
        except OSError:
            break
        if not chunk:
            break
        discarded += len(chunk)


class RuntimeServer(socketserver.TCPServer):
    """At most max_workers connection threads plus one inference thread; no queue.

    The kernel listen backlog is bounded separately. server_close does not join a
    hung trusted backend; its daemon thread retains the one slot until settlement.
    """
    allow_reuse_address = False
    request_queue_size = 8

    def __init__(self, address, backend=None, *, read_timeout=1.0,
                 inference_timeout=0.75, max_workers=4, listener=None):
        # Caller transfers ownership; close it even if argument validation fails.
        try:
            self._initialize(address, backend, read_timeout, inference_timeout, max_workers, listener)
        except BaseException:
            if listener is not None:
                listener.close()
            raise

    def _initialize(self, address, backend, read_timeout, inference_timeout, max_workers, listener):
        if address[0] != "127.0.0.1":
            raise ValueError("loopback IPv4 required")
        if type(max_workers) is not int or not 2 <= max_workers <= 8:
            raise ValueError("invalid worker bound")
        for timeout in (read_timeout, inference_timeout):
            if type(timeout) not in (int, float) or not math.isfinite(timeout) or not 0 < timeout <= 5:
                raise ValueError("invalid timeout bound")
        self.backend = backend
        self.read_timeout = read_timeout
        self.inference_timeout = inference_timeout
        self._workers = threading.BoundedSemaphore(max_workers)
        self._inference = threading.Lock()
        self._connections = set()
        self._connections_lock = threading.Lock()
        self._closing = False
        # Pins are a startup snapshot, never derived from model output.
        self._pins = self._backend_pins()
        if listener is None:
            super().__init__(address, Handler)
        else:
            validate_activation_socket(listener)
            if address != ("127.0.0.1", 8767):
                raise ValueError("activation address is fixed")
            # BaseServer initializes bookkeeping without creating another socket.
            socketserver.BaseServer.__init__(self, address, Handler)
            self.socket = listener

    def _backend_pins(self):
        try:
            pins = (self.backend.model_version, self.backend.calibration_version)
            if all(isinstance(pin, str) and bool(pin.strip()) for pin in pins):
                return pins
        except BaseException:
            # Foreign backend access must not escape to thread exception logging.
            pass
        return None

    def ready(self):
        try:
            return (not self._closing and self._pins is not None and self.backend.ready is True
                    and self._backend_pins() == self._pins)
        except BaseException:
            return False

    def process_request(self, request, client_address):
        if self._closing or not self._workers.acquire(blocking=False):
            try:
                request.settimeout(self.read_timeout)
                send(request, 503)
            except OSError:
                pass
            self.shutdown_request(request)
            return
        with self._connections_lock:
            self._connections.add(request)
        try:
            threading.Thread(target=self._serve_connection, args=(request, client_address), daemon=True).start()
        except Exception:
            self._release_connection(request)

    def _release_connection(self, request):
        self.shutdown_request(request)
        with self._connections_lock:
            self._connections.discard(request)
        self._workers.release()

    def _serve_connection(self, request, client_address):
        try:
            self.finish_request(request, client_address)
        except Exception:
            # This is an untrusted-network boundary: never emit tracebacks.
            pass
        finally:
            self._release_connection(request)

    def infer(self, request):
        if not self.ready() or not self._inference.acquire(blocking=False):
            return 503, ERROR
        completed = threading.Event()
        result = [ERROR]

        def work():
            try:
                request_id = request["requestId"]
                candidate_ids = {candidate["id"] for candidate in request["candidates"]}
                value = self.backend.decide(request)
                result[0] = encode_response(value, request_id, candidate_ids, self._pins)
                result.append(200)
            except BaseException:
                # Neither exception object nor raw model response crosses boundary.
                # Isolate backend SystemExit/KeyboardInterrupt too; the main CLI
                # thread still handles actual operator interrupts normally.
                pass
            finally:
                request.clear()
                self._inference.release()
                completed.set()

        try:
            threading.Thread(target=work, daemon=True).start()
        except Exception:
            self._inference.release()
            return 503, ERROR
        if not completed.wait(self.inference_timeout):
            return 503, ERROR
        return (200, result[0]) if len(result) == 2 else (503, ERROR)

    def handle_error(self, request, client_address):
        # socketserver's default would print the exception and peer address.
        pass

    def server_close(self):
        self._closing = True
        super().server_close()
        with self._connections_lock:
            for connection in self._connections:
                try:
                    connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass


class Handler(socketserver.BaseRequestHandler):
    def _read(self, length):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise Rejected(408)
        self.request.settimeout(remaining)
        value = self.request.recv(length)
        if not value:
            raise Rejected(400)
        return value

    def _line(self, limit, status):
        line = bytearray()
        while len(line) < limit:
            line.extend(self._read(1))
            if line.endswith(b"\r\n"):
                return bytes(line)
            if line.endswith(b"\n"):
                raise Rejected(400)
        raise Rejected(status)

    def handle(self):
        self.deadline = time.monotonic() + self.server.read_timeout
        try:
            status, body = self._dispatch()
        except Rejected as error:
            status, body = error.status, ERROR
        except socket.timeout:
            status, body = 408, ERROR
        except (Invalid, ValueError, UnicodeError, TypeError):
            status, body = 400, ERROR
        except Exception:
            status, body = 503, ERROR
        try:
            self.request.settimeout(self.server.read_timeout)
            send(self.request, status, body)
        except OSError:
            pass

    def _dispatch(self):
        line = self._line(MAX_LINE_BYTES, 400)
        parts = line[:-2].split(b" ")
        if len(parts) != 3 or parts[2] not in (b"HTTP/1.0", b"HTTP/1.1"):
            raise Rejected(400)
        method, path, _version = (part.decode("ascii") for part in parts)
        headers = {}
        count, size = 0, len(line)
        while True:
            line = self._line(MAX_HEADER_BYTES, 431)
            size += len(line)
            if size > MAX_HEADER_BYTES:
                raise Rejected(431)
            if line == b"\r\n":
                break
            count += 1
            if count > MAX_HEADERS:
                raise Rejected(431)
            name, separator, value = line[:-2].partition(b":")
            if not separator or not TOKEN.fullmatch(name) or any(byte < 32 and byte != 9 or byte == 127 for byte in value):
                raise Rejected(400)
            name = name.decode("ascii").lower()
            if name in headers:
                raise Rejected(400)
            headers[name] = value.decode("latin-1").strip(" \t")
        if any(name in headers for name in ("transfer-encoding", "content-encoding", "expect")):
            raise Rejected(400)
        length = headers.get("content-length")
        if length is not None and not re.fullmatch(r"[0-9]{1,8}", length):
            raise Rejected(400)
        length = int(length) if length is not None else None
        if length is not None and length > MAX_BODY_BYTES:
            raise Rejected(413)
        if "?" in path or path not in ("/health", "/ready", "/v1/decision"):
            raise Rejected(404)
        if (path == "/v1/decision" and method != "POST") or (path != "/v1/decision" and method != "GET"):
            raise Rejected(405)
        if method == "GET":
            if length not in (None, 0):
                raise Rejected(400)
            if path == "/health":
                return 200, b'{"status":"alive"}'
            return (200, b'{"status":"ready"}') if self.server.ready() else (503, ERROR)
        if length is None:
            raise Rejected(400)
        if not MEDIA.fullmatch(headers.get("content-type", "")):
            raise Rejected(415)
        body = bytearray()
        while len(body) < length:
            body.extend(self._read(length - len(body)))
        request = parse_request(body)
        body.clear()
        return self.server.infer(request)


def main():
    parser = argparse.ArgumentParser(description="Uninstalled, unqualified LAYA HTTP boundary (no backend)")
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1"])
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--artifact-dir", help="absolute prepared pinned offline artifact directory")
    parser.add_argument("--systemd-socket", action="store_true", help="adopt the fixed Linux fd 3 listener")
    args = parser.parse_args()
    listener = None
    if args.systemd_socket:
        try:
            listener = adopt_systemd_socket()
            if args.port != 8767:
                raise ValueError("activation port is fixed")
        except ValueError:
            if listener is not None:
                listener.close()
            print("activation unavailable", file=sys.stderr)
            return 1
    try:
        if listener is not None:
            # Default kernel action terminates even native startup that never
            # returns to Python. No handler, environment or CLI timeout override.
            signal.signal(signal.SIGALRM, signal.SIG_DFL)
            signal.setitimer(signal.ITIMER_REAL, STARTUP_TIMEOUT_SECONDS)
        backend = None
        if args.artifact_dir is not None:
            try:
                from backend import PinnedBackend
                backend = PinnedBackend(args.artifact_dir)
            except Exception:
                print("backend unavailable", file=sys.stderr)
                return 1
        with RuntimeServer((args.host, args.port), backend, listener=listener) as server:
            if listener is not None:
                signal.setitimer(signal.ITIMER_REAL, 0)
            try:
                server.serve_forever(poll_interval=0.1)
            except KeyboardInterrupt:
                pass
    finally:
        if listener is not None:
            signal.setitimer(signal.ITIMER_REAL, 0)
            listener.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
