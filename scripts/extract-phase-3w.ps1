# Phase 3w: split partials/linkage-solar-sidebar.html into section partials
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$solarPath = Join-Path $root 'partials\linkage-solar-sidebar.html'
if (-not (Test-Path $solarPath)) { throw "Missing $solarPath" }

$lines = [System.IO.File]::ReadAllLines($solarPath)
$markers = @{
    properties = 'id="solar-properties-panel"'
    simulation = 'Simulation Mode Group'
    actions    = 'System Stats'
}

$starts = @{}
foreach ($key in $markers.Keys) {
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match [regex]::Escape($markers[$key])) {
            $starts[$key] = $i + 1
            break
        }
    }
}
if ($starts.Count -ne 3) { throw "Marker count $($starts.Count): $($starts | ConvertTo-Json -Compress)" }

$ordered = @(
    @{ Name = 'linkage-solar-sidebar-palette.html';     From = 1; To = $starts.properties - 1 }
    @{ Name = 'linkage-solar-sidebar-properties.html';  From = $starts.properties; To = $starts.simulation - 1 }
    @{ Name = 'linkage-solar-sidebar-simulation.html';  From = $starts.simulation; To = $starts.actions - 1 }
    @{ Name = 'linkage-solar-sidebar-actions.html';     From = $starts.actions; To = $lines.Count }
)

$utf = [Text.UTF8Encoding]::new($false)
foreach ($chunk in $ordered) {
    $outPath = Join-Path $root ('partials\' + $chunk.Name)
    $slice = $lines[($chunk.From - 1)..($chunk.To - 1)]
    while ($slice.Count -gt 0 -and [string]::IsNullOrWhiteSpace($slice[$slice.Count - 1])) {
        $slice = $slice[0..($slice.Count - 2)]
    }
    [IO.File]::WriteAllLines($outPath, $slice, $utf)
    Write-Host "Wrote $($chunk.Name): $($slice.Count) lines"
}
Remove-Item $solarPath -Force
Write-Host "Removed linkage-solar-sidebar.html"

$splitTopbar = Join-Path $PSScriptRoot 'extract-phase-3x.ps1'
if (Test-Path $splitTopbar) {
    & $splitTopbar
}
