# Registers a per-user Windows Scheduled Task that regenerates the Security Command
# Center dashboard every hour (the "hourly check"). No admin elevation required.
# Remove it any time with unregister-hourly-task.ps1.
$ErrorActionPreference = "Stop"
$here    = Split-Path -Parent $MyInvocation.MyCommand.Definition
$taskName = "DocmeeSecurityDashboard"

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw "python not found on PATH - install Python or add it to PATH first." }

$action = New-ScheduledTaskAction -Execute $python -Argument "build_security_dashboard.py" -WorkingDirectory $here
# Fire once now, then repeat every hour. Setting only the interval (no duration) =
# repeat indefinitely, and avoids the MaxValue-duration bug in New-ScheduledTaskTrigger.
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date)
$trigger.Repetition = New-CimInstance -ClassName MSFT_TaskRepetitionPattern `
    -Namespace Root/Microsoft/Windows/TaskScheduler -ClientOnly `
    -Property @{ Interval = "PT1H" }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Hourly mechanical refresh of the Docmee Security Command Center (tracker + live code scan + git). Deep AI re-audit is separate." `
    -Force | Out-Null

Write-Host "Registered scheduled task '$taskName' - regenerates the dashboard hourly."
Write-Host "Inspect:   Get-ScheduledTask -TaskName $taskName"
Write-Host "Run now:   Start-ScheduledTask -TaskName $taskName"
Write-Host "Remove:    .\unregister-hourly-task.ps1"
