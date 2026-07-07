$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appExe = Join-Path $toolsDir "app\src-tauri\target\debug\docmee-devtools.exe"
$tauriDir = Join-Path $toolsDir "app\src-tauri"
$nextBin = Join-Path $toolsDir "dashboard\node_modules\next\dist\bin\next"
$tsxBin = Join-Path $toolsDir "node_modules\tsx\dist\cli.mjs"
$sentinelEntry = Join-Path $toolsDir "sentinel\daemon.ts"
$logsDir = Join-Path $toolsDir "logs"
$launcherLog = Join-Path $logsDir "devtools-launcher.log"

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Write-LauncherLog {
  param([string]$Message)
  $timestamp = (Get-Date).ToString("s")
  Add-Content -Path $launcherLog -Value "$timestamp $Message"
}

function Test-Dashboard {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:4000/api/health" -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Test-Sentinel {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:4001/health" -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-DashboardHost {
  if ($env:DOCMEE_DEVTOOLS_HOST) {
    return $env:DOCMEE_DEVTOOLS_HOST
  }
  $tailscale = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.InterfaceAlias -match 'Tailscale' -or $_.IPAddress -like '100.*' } |
    Select-Object -First 1
  if ($tailscale) {
    return "0.0.0.0"
  }
  return "127.0.0.1"
}

function Get-NodePath {
  $hermesNode = "C:\Users\Jungl\AppData\Local\hermes\node\node.exe"
  if (Test-Path $hermesNode) {
    return $hermesNode
  }
  return (Get-Command node -ErrorAction Stop).Source
}

function Stop-StaleDashboard {
  $connections = Get-NetTCPConnection -LocalPort 4000 -State Listen -ErrorAction SilentlyContinue
  foreach ($connection in $connections) {
    $processId = $connection.OwningProcess
    if (-not $processId) { continue }

    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction SilentlyContinue
    $commandLine = if ($processInfo) { [string]$processInfo.CommandLine } else { "" }
    $isDashboardProcess = $commandLine -like "*Creascent-Development*tools*dashboard*" -or
      $commandLine -like "*next*dev*-p 4000*" -or
      $commandLine -like "*next*dist*bin*next*"

    if ($isDashboardProcess) {
      Write-LauncherLog "Stopping stale dashboard process $processId."
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    } else {
      Write-LauncherLog "Port 4000 is occupied by a non-dashboard process $processId. Command: $commandLine"
    }
  }
}

function Start-Dashboard {
  if (-not (Test-Path $nextBin)) {
    throw "Dashboard runtime is missing. Expected: $nextBin"
  }

  $node = Get-NodePath
  $dashboardHost = Get-DashboardHost
  $buildId = Join-Path $toolsDir "dashboard\.next\BUILD_ID"
  $nextMode = if (Test-Path $buildId) { "start" } else { "dev" }
  $nextArgs = "`"$nextBin`" $nextMode -p 4000 -H $dashboardHost"
  Write-LauncherLog "Starting dashboard on $dashboardHost:4000 with direct Next runner ($nextMode)."
  Start-Process `
    -FilePath $node `
    -ArgumentList $nextArgs `
    -WorkingDirectory (Join-Path $toolsDir "dashboard") `
    -WindowStyle Hidden
}

if (-not (Test-Dashboard)) {
  Write-LauncherLog "Dashboard is not ready before launch."
  Stop-StaleDashboard
  Start-Dashboard

  for ($i = 0; $i -lt 60; $i++) {
    if (Test-Dashboard) { break }
    Start-Sleep -Seconds 1
  }
}

if (-not (Test-Dashboard)) {
  Write-LauncherLog "Dashboard failed to become ready after startup."
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show(
    "Docmee DevTools could not start the dashboard on port 4000. Open logs\devtools-launcher.log for details.",
    "Docmee DevTools",
    "OK",
    "Error"
  ) | Out-Null
  exit 1
}

Write-LauncherLog "Dashboard is ready."

# Start the Sentinel daemon (independent process) if it is not already running.
if (-not (Test-Sentinel)) {
  $node = Get-NodePath
  Write-LauncherLog "Starting Sentinel daemon."
  Start-Process `
    -FilePath $node `
    -ArgumentList "`"$tsxBin`" `"$sentinelEntry`"" `
    -WorkingDirectory $toolsDir `
    -WindowStyle Hidden
}

if (-not (Test-Path $appExe)) {
  $cargo = (Get-Command cargo -ErrorAction Stop).Source
  Start-Process `
    -FilePath $cargo `
    -ArgumentList @("build") `
    -WorkingDirectory $tauriDir `
    -WindowStyle Hidden `
    -Wait
}

Start-Process `
  -FilePath $appExe `
  -WorkingDirectory $toolsDir `
  -WindowStyle Normal
