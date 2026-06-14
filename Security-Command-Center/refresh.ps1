# Manual refresh: re-reads the tracker + live code + git and regenerates the dashboard.
# This is the MECHANICAL refresh (data + heuristic scan). It does NOT re-run the AI
# analysis - that lives in findings.json (see README "Deep re-audit").
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
Push-Location $here
try {
    python build_security_dashboard.py
} finally {
    Pop-Location
}
