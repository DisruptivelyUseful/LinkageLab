# Phase 3t: split partials/linkage-controls.html into section partials
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$controlsPath = Join-Path $root 'partials\linkage-controls.html'
if (-not (Test-Path $controlsPath)) { throw "Missing $controlsPath" }

$lines = [System.IO.File]::ReadAllLines($controlsPath)
$markers = @{
    structure = 'Structure Rotation'
    costs     = 'Material Costs'
    reference = 'Measurements'
    solar     = 'id="solar-panel-group"'
    support   = 'Support Beams - Independent section'
}

$starts = @{}
foreach ($key in $markers.Keys) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match [regex]::Escape($markers[$key]) -or $lines[$i] -match $markers[$key]) {
            $starts[$key] = $i + 1
            break
        }
    }
}
if ($starts.Count -ne 5) { throw "Marker count $($starts.Count): $($starts | ConvertTo-Json -Compress)" }

$ordered = @(
    @{ Name = 'linkage-controls-head.html';      From = 1; To = $starts.structure - 1 }
    @{ Name = 'linkage-controls-structure.html'; From = $starts.structure; To = $starts.costs - 1 }
    @{ Name = 'linkage-controls-costs.html';    From = $starts.costs; To = $starts.reference - 1 }
    @{ Name = 'linkage-controls-reference.html'; From = $starts.reference; To = $starts.solar - 1 }
    @{ Name = 'linkage-controls-solar-panels.html'; From = $starts.solar; To = $starts.support - 1 }
    @{ Name = 'linkage-controls-support.html';   From = $starts.support; To = $lines.Count }
)

$utf = [Text.UTF8Encoding]::new($false)
foreach ($chunk in $ordered) {
    $outPath = Join-Path $root ('partials\' + $chunk.Name)
    $slice = $lines[($chunk.From - 1)..($chunk.To - 1)]
    [IO.File]::WriteAllLines($outPath, $slice, $utf)
    Write-Host "Wrote $($chunk.Name): $($slice.Count) lines"
}
Remove-Item $controlsPath -Force
Write-Host "Removed linkage-controls.html"

$splitWorkspace = Join-Path $PSScriptRoot 'extract-phase-3u.ps1'
if (Test-Path $splitWorkspace) {
    & $splitWorkspace
}
