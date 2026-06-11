# Phase 3r: split partials/linkage-app.html into topbar, sidebar, workspace
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$appPath = Join-Path $root 'partials\linkage-app.html'
if (-not (Test-Path $appPath)) { throw "Missing $appPath (run extract-phase-3q.ps1 first)" }

$lines = [System.IO.File]::ReadAllLines($appPath)
$sidebarStart = 0
$workspaceStart = 0

for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($lines[$i] -eq '<div id="sidebar">') { $sidebarStart = $ln }
    if ($sidebarStart -gt 0 -and $workspaceStart -eq 0 -and $lines[$i] -match 'id="sidebar-toggle"') { $workspaceStart = $ln }
}

if ($sidebarStart -eq 0 -or $workspaceStart -eq 0) {
    throw "Split markers missing: sidebar=$sidebarStart workspace=$workspaceStart"
}

$top = $lines[0..($sidebarStart - 2)]
$sidebar = $lines[($sidebarStart - 1)..($workspaceStart - 2)]
$workspace = $lines[($workspaceStart - 1)..($lines.Count - 1)]

$utf = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllLines((Join-Path $root 'partials\linkage-topbar.html'), $top, $utf)
[IO.File]::WriteAllLines((Join-Path $root 'partials\linkage-sidebar.html'), $sidebar, $utf)
[IO.File]::WriteAllLines((Join-Path $root 'partials\linkage-workspace.html'), $workspace, $utf)
Remove-Item $appPath -Force

Write-Host "Wrote topbar: $($top.Count), sidebar: $($sidebar.Count), workspace: $($workspace.Count) lines"
Write-Host "Removed linkage-app.html"

$splitSidebar = Join-Path $PSScriptRoot 'extract-phase-3s.ps1'
if (Test-Path $splitSidebar) {
    & $splitSidebar
}
