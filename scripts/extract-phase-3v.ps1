# Phase 3v: split partials/linkage-modals.html into modal partials
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$modalsPath = Join-Path $root 'partials\linkage-modals.html'
if (-not (Test-Path $modalsPath)) { throw "Missing $modalsPath" }

$lines = [System.IO.File]::ReadAllLines($modalsPath)
$buildGuideStart = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'id="build-guide-modal"') { $buildGuideStart = $i + 1; break }
}
if ($buildGuideStart -eq 0) { throw 'build-guide-modal marker not found' }

$ordered = @(
    @{ Name = 'linkage-modal-hardware.html'; From = 1; To = $buildGuideStart - 1 }
    @{ Name = 'linkage-modal-build-guide.html'; From = $buildGuideStart; To = $lines.Count }
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
Remove-Item $modalsPath -Force
Write-Host "Removed linkage-modals.html"

$splitSolar = Join-Path $PSScriptRoot 'extract-phase-3w.ps1'
if (Test-Path $splitSolar) {
    & $splitSolar
}
