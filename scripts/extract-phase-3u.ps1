# Phase 3u: split partials/linkage-workspace.html into section partials
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$workspacePath = Join-Path $root 'partials\linkage-workspace.html'
if (-not (Test-Path $workspacePath)) { throw "Missing $workspacePath" }

$lines = [System.IO.File]::ReadAllLines($workspacePath)
$markers = @{
    solar = 'id="solar-canvas-container"'
    hud   = 'id="right-panel"'
}

$starts = @{}
foreach ($key in $markers.Keys) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $markers[$key]) {
            $starts[$key] = $i + 1
            break
        }
    }
}
if ($starts.Count -ne 2) { throw "Marker count $($starts.Count): $($starts | ConvertTo-Json -Compress)" }

$ordered = @(
    @{ Name = 'linkage-workspace-viewport.html'; From = 1; To = $starts.solar - 1 }
    @{ Name = 'linkage-workspace-solar.html';    From = $starts.solar; To = $starts.hud - 1 }
    @{ Name = 'linkage-workspace-hud.html';       From = $starts.hud; To = $lines.Count }
)

$utf = [Text.UTF8Encoding]::new($false)
foreach ($chunk in $ordered) {
    $outPath = Join-Path $root ('partials\' + $chunk.Name)
    $slice = $lines[($chunk.From - 1)..($chunk.To - 1)]
    [IO.File]::WriteAllLines($outPath, $slice, $utf)
    Write-Host "Wrote $($chunk.Name): $($slice.Count) lines"
}
Remove-Item $workspacePath -Force
Write-Host "Removed linkage-workspace.html"

$splitModals = Join-Path $PSScriptRoot 'extract-phase-3v.ps1'
if (Test-Path $splitModals) {
    & $splitModals
}
