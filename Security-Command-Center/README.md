# Docmee — Security Command Center

An independent **security oversight dashboard** for the Docmee build, modeled on the
Docmee Command Center. It surfaces security findings — each with the four-part
advisory framework (**Threat · Blast Radius · Cause · Solution**) and a **confidence
rating (0–10)** — and watches the build for new Backend/Frontend code.

It is a *separate advisory layer*: it reads the tracker, the live code, and git, but
**touches none** of the monorepo / Backend / Frontend source.

## Open it
Double-click **`Security-Dashboard.html`** — opens in your browser, offline, no server.
Or serve it like the main dashboard: `python -m http.server 8772 --directory .`
(preview config `security-dashboard` is in `monorepo/.claude/launch.json`).

## Tabs
- **Overview** — KPIs (findings, action items ≥ conf 8, critical/high open, code-scan
  flags, verified/holds, watchlist), severity bars, confidence distribution, disposition
  donut, top action items, recent commits, and a **freshness banner**.
- **Action Plan** — every finding at **confidence ≥ 8** that needs action, as a full
  four-part card with a recommended next step. *This is the plan.*
- **All Findings** — the complete table (tracker SEC + risks + code). Click a row for
  its four-part detail.
- **Code & Scan** — the live heuristic code scan, AI-authored code findings, **tracker
  drift**, and **unanalyzed new items**.
- **Watchlist** — findings at **confidence < 8** (real, but residual uncertainty or
  pending not-yet-built code), shown so nothing is silently dropped.

## How it works (two layers)

| Layer | What it is | Refreshed by |
|---|---|---|
| **Mechanical refresh** | Re-reads `docmee-trackers.xlsx`, re-scans the live code (heuristics), re-pulls git, recomputes drift/freshness, regenerates the HTML. | `build_security_dashboard.py` — runs **hourly** via the scheduled task, or on demand. |
| **Deep AI re-audit** | The actual security analysis — confidence ratings, four-part advice, new findings from *reading* new code. Lives in `findings.json`. | Re-running the security advisor (me), which rewrites `findings.json`. |

The mechanical layer keeps the numbers, scan, and git delta current every hour. When new
Backend/Frontend code lands (or the monorepo HEAD moves past the audited commit), the
dashboard raises a **“code changed — request a deep re-audit”** banner: the data is fresh,
but the AI findings still reflect the audited commit until re-audited.

## Refresh

**Manual (mechanical):** click **↻** in the dashboard header, or:
```powershell
.\refresh.ps1            # or:  python build_security_dashboard.py
```

**Hourly (mechanical):** a per-user Windows Scheduled Task `DocmeeSecurityDashboard`
runs the generator every hour. Already registered. Manage it:
```powershell
.\register-hourly-task.ps1     # (re)register the hourly task
.\unregister-hourly-task.ps1   # remove it
Get-ScheduledTask  -TaskName DocmeeSecurityDashboard
Start-ScheduledTask -TaskName DocmeeSecurityDashboard   # run now
```
The dashboard’s in-page **Auto-reload** (header) reloads the file on an interval
(default off; options 5m/15m/30m/1h) so an always-open tab shows each hourly rebuild.

**Deep re-audit (AI):** when the banner flags new code, ask the security advisor to
re-audit — it reads the new Backend/Frontend code, updates/extends `findings.json`
(confidence + four-part advice), advances `audit_head`, and you re-run the generator.

## Confidence scale
`0–10`. **≥ 8** = high-confidence, actionable now → **Action Plan**.
`5–7` = real but residual uncertainty / depends on unbuilt code → **Watchlist**.
`< 5` = speculative.

## Files
- `Security-Dashboard.html` — the deliverable (open this)
- `findings.json` — **authored AI analysis** (source of truth for advice + confidence)
- `build_security_dashboard.py` — generator (tracker + code scan + git → HTML)
- `template.html` — HTML/CSS/JS template the generator fills in
- `refresh.ps1` · `register-hourly-task.ps1` · `unregister-hourly-task.ps1`
- `scan-state.json` — last-run state (head, branch, scan counts) — auto-written

## Inputs
- `../Trackers/docmee-trackers.xlsx` (Security Audit + Risk Register) — requires `openpyxl`
- `../monorepo`, `../Backend`, `../Frontend` — live code scan + git state
