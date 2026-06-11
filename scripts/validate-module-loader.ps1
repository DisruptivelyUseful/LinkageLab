# Verify paths in config/linkage-manifest.json exist on disk
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$manifestPath = Join-Path $root 'config\linkage-manifest.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
$missing = [System.Collections.Generic.List[string]]::new()

foreach ($p in $manifest.partials) {
    $full = Join-Path $root ($p.path -replace '/', '\')
    if (-not (Test-Path $full)) { [void]$missing.Add($p.path) }
}
foreach ($s in $manifest.scripts) {
    $path = if ($s -is [string]) { $s } else { $s.path }
    $full = Join-Path $root ($path -replace '/', '\')
    if (-not (Test-Path $full)) { [void]$missing.Add($path) }
}
if (-not (Test-Path (Join-Path $root 'js\linkage\global-bridge.js'))) {
    [void]$missing.Add('js/linkage/global-bridge.js')
}
if ($manifest.cdn) {
    foreach ($c in $manifest.cdn) {
        if ($c -match '^https?://') { continue }
        $full = Join-Path $root ($c -replace '/', '\')
        if (-not (Test-Path $full)) { [void]$missing.Add($c) }
    }
}
if (-not (Test-Path (Join-Path $root 'js\linkage\bootstrap.js'))) {
    [void]$missing.Add('js/linkage/bootstrap.js')
}

if ($missing.Count) {
    Write-Error "Missing paths:`n$($missing | Select-Object -Unique | ForEach-Object { $_ } | Out-String)"
}
$cdnCount = if ($manifest.cdn) { $manifest.cdn.Count } else { 0 }
$esmCount = @($manifest.scripts | Where-Object { $_ -isnot [string] -and $_.format -eq 'esm' }).Count
Write-Host "linkage-manifest.json: $cdnCount CDN, $($manifest.partials.Count) partials, $($manifest.scripts.Count) scripts ($esmCount ESM) - all present"
