$toolsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Docmee DevTools.lnk"
$launcher = Join-Path $toolsDir "Launch Docmee DevTools.vbs"
$icon = Join-Path $toolsDir "app\src-tauri\icons\icon.ico"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "$env:WINDIR\System32\wscript.exe"
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $toolsDir
$shortcut.Description = "Launch Docmee DevTools"
$shortcut.IconLocation = $icon
$shortcut.Save()

Write-Output "Created $shortcutPath"
