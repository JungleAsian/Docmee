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

## Refresh from source
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
- `template.html` — HTML/CSS/JS template the generator fills in
