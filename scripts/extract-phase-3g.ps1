# Extract solar panel system + buildLinkageGeometry from index.html (Phase 3g)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

$startLine = 3071
$endLine = 6819

$chunk = $lines[($startLine - 1)..($endLine - 1)]

$exportNames = [System.Collections.Generic.List[string]]::new()
foreach ($line in $chunk) {
    if ($line -match '^function\s+(\w+)\s*\(') {
        [void]$exportNames.Add($Matches[1])
    } elseif ($line -match '^async\s+function\s+(\w+)\s*\(') {
        [void]$exportNames.Add($Matches[1])
    }
}
$exportNames = $exportNames | Select-Object -Unique | Sort-Object
Write-Host "Functions to export: $($exportNames.Count)"

$header = @(
    '// ============================================================================',
    '// LINKAGE LAB - Linkage geometry (solar panels, support beams, buildLinkageGeometry)',
    '// Depends on global: state, solveLinkage, getLinkageData, geometry-classes helpers, math, Panel3D',
    '// ============================================================================',
    '(function (g) {',
    "    'use strict';",
    ''
)
$footer = @(
    '',
    '    g.LinkageModules = g.LinkageModules || {};',
    '    g.LinkageModules.linkageGeometry = { buildLinkageGeometry };',
    ''
)
foreach ($name in $exportNames) {
    $footer += "    g.$name = $name;"
}
$footer += @('', '})(window);', '')

$indented = $chunk | ForEach-Object { "    $_" }
$all = $header + $indented + $footer

$outPath = Join-Path $root 'js\linkage\linkage-geometry.js'
[System.IO.File]::WriteAllLines($outPath, $all, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $($all.Count) lines to $outPath"

# Strip from index.html
$tempPath = "$indexPath.tmp"
$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($ln -ge $startLine -and $ln -le $endLine) {
        if ($ln -eq $startLine) {
            $out.Add('// Linkage geometry (solar panels, support beams) - js/linkage/linkage-geometry.js')
            $out.Add('')
        }
        continue
    }
    $out.Add($lines[$i])
}
[System.IO.File]::WriteAllLines($tempPath, $out, [System.Text.UTF8Encoding]::new($false))
Move-Item -Path $tempPath -Destination $indexPath -Force
Write-Host "Stripped index.html: $($lines.Count) -> $($out.Count) lines"
