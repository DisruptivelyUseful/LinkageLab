# Phase 3s: split partials/linkage-sidebar.html into controls + solar-sidebar
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$sidebarPath = Join-Path $root 'partials\linkage-sidebar.html'
if (-not (Test-Path $sidebarPath)) { throw "Missing $sidebarPath" }

$lines = [System.IO.File]::ReadAllLines($sidebarPath)
$solarStart = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'id="solar-sidebar"') { $solarStart = $i + 1; break }
}
if ($solarStart -eq 0) { throw 'solar-sidebar marker not found' }

# End controls at the line before solar-sidebar (keep sidebar wrapper open).
$controlsEnd = $solarStart - 1
while ($controlsEnd -gt 0 -and [string]::IsNullOrWhiteSpace($lines[$controlsEnd - 1])) { $controlsEnd-- }
while ($controlsEnd -gt 0 -and $lines[$controlsEnd - 1] -match 'Solar Design Sidebar') { $controlsEnd-- }
while ($controlsEnd -gt 0 -and [string]::IsNullOrWhiteSpace($lines[$controlsEnd - 1])) { $controlsEnd-- }

$controls = $lines[0..($controlsEnd - 1)]
$solar = $lines[($solarStart - 1)..($lines.Count - 1)]

$utf = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllLines((Join-Path $root 'partials\linkage-controls.html'), $controls, $utf)
[IO.File]::WriteAllLines((Join-Path $root 'partials\linkage-solar-sidebar.html'), $solar, $utf)
Remove-Item $sidebarPath -Force

Write-Host "Wrote controls: $($controls.Count), solar-sidebar: $($solar.Count) lines"
Write-Host "Removed linkage-sidebar.html"

$splitControls = Join-Path $PSScriptRoot 'extract-phase-3t.ps1'
if (Test-Path $splitControls) {
    & $splitControls
}
