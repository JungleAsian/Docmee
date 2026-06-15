# Removes the hourly Docmee Discord status-bot scheduled task.
$ErrorActionPreference = "Stop"
$taskName = "DocmeeDiscordBot"
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "Removed scheduled task '$taskName'."
} else {
    Write-Host "No scheduled task '$taskName' found - nothing to remove."
}
