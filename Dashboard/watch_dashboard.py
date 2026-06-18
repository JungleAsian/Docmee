# -*- coding: utf-8 -*-
"""
Auto-refresh watcher for the Docmee Command Center dashboard.

Polls the tracker spreadsheet's mtime and the monorepo's latest commit; whenever
either changes it regenerates Docmee-Dashboard.html. Pair it with the in-page
auto-reload toggle (top-right of the dashboard) so an open browser tab updates
itself with fresh data.

Run:   python watch_dashboard.py            (polls every 15s)
       python watch_dashboard.py 30         (polls every 30s)
Stop:  Ctrl+C
"""
import sys, time, subprocess, pathlib
import build_dashboard as bd

POLL = int(sys.argv[1]) if len(sys.argv) > 1 else 15

def fingerprint():
    xlsx = bd.XLSX.stat().st_mtime if bd.XLSX.exists() else 0
    try:
        head = subprocess.run(["git", "-C", str(bd.MONOREPO), "rev-parse", "HEAD"],
                              capture_output=True, text=True).stdout.strip()
    except Exception:
        head = ""
    return (xlsx, head)

def main():
    print(f"Watching {bd.XLSX.name} + monorepo git (poll {POLL}s). Ctrl+C to stop.")
    last = None
    while True:
        fp = fingerprint()
        if fp != last:
            try:
                bd.main()
            except Exception as e:
                print(f"  regenerate failed: {e}")
            last = fp
        time.sleep(POLL)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nstopped.")
