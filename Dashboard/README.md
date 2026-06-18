# Docmee — Command Center (dashboard)

A self-contained web dashboard to monitor **Alpha** (frontend agent) and **Prime**
(backend agent) progress, plus the full planning/dev tracker.

## Open it
Double-click **`Docmee-Dashboard.html`** — it opens in your browser. No server, no
install, works offline. All data and charts are baked into the one file.

## Tabs
- **Overview** — KPIs (phases sealed, decisions, gates, gaps, risks, security), both
  agent build gauges, recent commits, gates-per-phase chart, spec coverage.
- **Alpha & Prime** — build gauges, owned workspaces, the Sprint-0 ticket board, and
  the external blockers (X1/X5/X6/X7/X20).
- **Roadmap** — the 26-week plan: every phase split into a Prime track and an Alpha
  track with an integration checkpoint.
- **Tracker** — Action Tracker (X1–X20), all 88 phase gates, future improvements,
  and status donuts.
- **Risk & Security** — the 24-item security audit and 13-risk register, by priority.

## Update statuses (you, as dashboard manager)
On the **Alpha & Prime** and **Roadmap** tabs, **click a ticket or a track** to advance
its status: *Not started → In progress → Done*. The build gauges recompute live. Your
statuses are saved in the browser (localStorage) — they persist across reloads on the
same machine/browser.

## Auto-refresh
The dashboard keeps itself current in two halves:

1. **In-page auto-reload** — top-right of the dashboard: **● Auto-refresh On**, an
   interval button (30s / 1m / 2m / 5m), a manual **↻**, and a live countdown. The tab
   reloads on the interval and re-reads the file from disk. Your clicked statuses survive
   (they live in localStorage, not the file). Toggle/interval are remembered per browser.
   Default: On, every 60s.
2. **The watcher** — regenerates the HTML when the tracker or git state changes, so a
   reload actually has fresh data to show:
   ```
   cd Dashboard
   python watch_dashboard.py        # polls every 15s
   python watch_dashboard.py 30     # poll every 30s; Ctrl+C to stop
   ```
   It only rewrites the file when `docmee-trackers.xlsx` (mtime) or the monorepo's latest
   commit changes — otherwise it's idle.

Leave the watcher running and the dashboard tab open: edits to the tracker (or new commits)
flow to the open tab within a poll + reload cycle, hands-free.

## Refresh from source (manual)
The dashboard is generated from the tracker spreadsheet + the monorepo's git state.
After the tracker or repo changes, regenerate:

```
cd Dashboard
python build_dashboard.py
```

Requires `openpyxl` (`pip install openpyxl`). Inputs:
- `../Trackers/docmee-trackers.xlsx` — source of truth (16 tabs)
- `../monorepo` — git branch + recent commits

Output: `Docmee-Dashboard.html` (regenerated in place).

> Note: regenerating rebuilds the *data*. Your manually-set ticket/track statuses live
> in the browser, not the file, so they survive a regenerate.

## Files
- `Docmee-Dashboard.html` — the deliverable (open this)
- `build_dashboard.py` — generator (extracts data → HTML)
- `watch_dashboard.py` — auto-refresh watcher (regenerates on change)
- `template.html` — HTML/CSS/JS template the generator fills in
