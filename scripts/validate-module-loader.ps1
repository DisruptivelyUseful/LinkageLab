# Verify every path in js/linkage/module-loader.js SCRIPTS array exists on disk
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$loaderPath = Join-Path $root 'js\linkage\module-loader.js'
$content = Get-Content $loaderPath -Raw
$matches = [regex]::Matches($content, "'([^']+\.js)'")
$missing = @()
foreach ($m in $matches) {
    $rel = $m.Groups[1].Value
    $full = Join-Path $root ($rel -replace '/', '\')
    if (-not (Test-Path $full)) { $missing += $rel }
}
if ($missing.Count) {
    Write-Error "Missing scripts:`n$($missing -join "`n")"
}
Write-Host "module-loader.js: $($matches.Count) scripts, all present"
