# Registers a per-user Windows Scheduled Task that runs the Docmee Discord status
# bot every hour. It only posts when something changed, so the hourly cadence
# does not spam the channels. No admin elevation required.
# Remove it any time with unregister-hourly-task.ps1.
$ErrorActionPreference = "Stop"
$here     = Split-Path -Parent $MyInvocation.MyCommand.Definition
$taskName = "DocmeeDiscordBot"

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { throw "python not found on PATH - install Python or add it to PATH first." }

if (-not (Test-Path (Join-Path $here ".env"))) {
    Write-Warning "No .env found in $here - copy .env.example to .env and fill in the token/channel IDs before the task can post."
}

$action = New-ScheduledTaskAction -Execute $python -Argument "discord_bot.py" -WorkingDirectory $here
# Fire once now, then repeat every hour (interval only = repeat indefinitely;
# avoids the MaxValue-duration bug in New-ScheduledTaskTrigger).
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date)
$trigger.Repetition = New-CimInstance -ClassName MSFT_TaskRepetitionPattern `
    -Namespace Root/Microsoft/Windows/TaskScheduler -ClientOnly `
    -Property @{ Interval = "PT1H" }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Hourly Docmee status post to Discord (technical + non-technical channels). Posts only when status changed." `
    -Force | Out-Null

Write-Host "Registered scheduled task '$taskName' - posts hourly when status changes."
Write-Host "Inspect:   Get-ScheduledTask -TaskName $taskName"
Write-Host "Run now:   Start-ScheduledTask -TaskName $taskName"
Write-Host "Remove:    .\unregister-hourly-task.ps1"
