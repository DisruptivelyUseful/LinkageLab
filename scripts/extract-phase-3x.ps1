# Phase 3x: split partials/linkage-topbar.html into section partials
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$topbarPath = Join-Path $root 'partials\linkage-topbar.html'
if (-not (Test-Path $topbarPath)) { throw "Missing $topbarPath" }

$lines = [System.IO.File]::ReadAllLines($topbarPath)
$markers = @{
    center = 'class="topbar-center"'
    right  = 'class="topbar-right"'
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
if ($starts.Count -ne 2) { throw "Marker count $($starts.Count): $($starts | ConvertTo-Json -Compress)" }

$ordered = @(
    @{ Name = 'linkage-topbar-left.html';   From = 1; To = $starts.center - 1 }
    @{ Name = 'linkage-topbar-center.html'; From = $starts.center; To = $starts.right - 1 }
    @{ Name = 'linkage-topbar-right.html';  From = $starts.right; To = $lines.Count }
)

$utf = [Text.UTF8Encoding]::new($false)
foreach ($chunk in $ordered) {
    $outPath = Join-Path $root ('partials\' + $chunk.Name)
    $slice = $lines[($chunk.From - 1)..($chunk.To - 1)]
    [IO.File]::WriteAllLines($outPath, $slice, $utf)
    Write-Host "Wrote $($chunk.Name): $($slice.Count) lines"
}
Remove-Item $topbarPath -Force
Write-Host "Removed linkage-topbar.html"
