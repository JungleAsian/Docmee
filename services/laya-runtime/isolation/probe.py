"""Linux-only synthetic negative probes. Never read or print file contents."""
import errno
import os
from pathlib import Path
import socket
import sys


def inaccessible_canary(path):
    # Operator first verifies this synthetic file exists outside the sandbox.
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        return error.errno in (errno.EACCES, errno.EPERM, errno.ENOENT)
    os.close(descriptor)  # No reads, even if isolation failed.
    return False


def release_readonly(path):
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError as error:
        return error.errno in (errno.EACCES, errno.EPERM, errno.EROFS)
    os.close(descriptor)  # No truncation or writes, even on failure.
    return False


def blocked_network(host, port, *, udp=False):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM if udp else socket.SOCK_STREAM) as sock:
            sock.settimeout(0.25)
            if udp:
                # Empty datagram, TEST-NET or link-local address; no user data.
                sock.sendto(b"", (host, port))
            else:
                sock.connect((host, port))
    except OSError as error:
        # Refusal or timeout is not evidence of enforcement. TCP must hit the
        # connect deny; unconnected UDP must hit isolation/no-route or denial.
        accepted = (errno.EPERM, errno.EACCES, errno.ENETUNREACH) if udp else (errno.EPERM, errno.EACCES)
        return error.errno in accepted
    return False


def blocked_family(family):
    try:
        with socket.socket(family, socket.SOCK_STREAM):
            pass
    except OSError as error:
        return error.errno in (errno.EPERM, errno.EACCES, errno.EAFNOSUPPORT)
    return False


def emit_results(results):
    # Only fixed caller-owned category keys and booleans enter this output.
    for category, passed in results.items():
        print(category + (":PASS" if passed is True else ":FAIL"))
    return 0 if all(value is True for value in results.values()) else 1


def main():
    if sys.platform != "linux":
        return emit_results({"platform": False})
    results = {
        "identity": os.getuid() != 0 and os.geteuid() != 0,
        "application": inaccessible_canary("/opt/docmee/.laya-isolation-canary"),
        "credentials": inaccessible_canary("/run/credentials/.laya-isolation-canary"),
        "release": release_readonly(Path(__file__).absolute()),
        "tcp": blocked_network("192.0.2.1", 9),
        "udp": blocked_network("192.0.2.1", 9, udp=True),
        "dns": blocked_network("192.0.2.53", 53, udp=True),
        "metadata": blocked_network("169.254.169.254", 80, udp=True),
        "host": blocked_network("127.0.0.1", 8767),
        "families": all(blocked_family(family) for family in (socket.AF_INET6, socket.AF_UNIX)),
    }
    return emit_results(results)


if __name__ == "__main__":
    raise SystemExit(main())
