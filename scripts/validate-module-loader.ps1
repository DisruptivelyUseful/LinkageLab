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
    $full = Join-Path $root ($s -replace '/', '\')
    if (-not (Test-Path $full)) { [void]$missing.Add($s) }
}
if (-not (Test-Path (Join-Path $root 'js\linkage\module-loader.js'))) {
    [void]$missing.Add('js/linkage/module-loader.js')
}

if ($missing.Count) {
    Write-Error "Missing paths:`n$($missing | Select-Object -Unique | ForEach-Object { $_ } | Out-String)"
}
Write-Host "linkage-manifest.json: $($manifest.partials.Count) partials, $($manifest.scripts.Count) scripts - all present"
