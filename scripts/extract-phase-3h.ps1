# Extract render loop, HUD, and 2D canvas fallback (Phase 3h)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

# Include JSDoc above updateSolarPanelStats (starts ~3075); end at drawGrid3D closing brace
$ranges = @(
    @{ Start = 3041; End = 3070 },
    @{ Start = 3075; End = 4804 }
)

$chunk = [System.Collections.Generic.List[string]]::new()
foreach ($r in $ranges) {
    foreach ($line in $lines[($r.Start - 1)..($r.End - 1)]) {
        [void]$chunk.Add($line)
    }
}

$exportNames = [System.Collections.Generic.List[string]]::new()
foreach ($line in $chunk) {
    if ($line -match '^function\s+(\w+)\s*\(') {
        [void]$exportNames.Add($Matches[1])
    } elseif ($line -match '^async\s+function\s+(\w+)\s*\(') {
        [void]$exportNames.Add($Matches[1])
    }
}
$exportNames = $exportNames | Select-Object -Unique | Sort-Object
Write-Host "Functions to export: $($exportNames.Count) -> $($exportNames -join ', ')"

$header = @(
    '// ============================================================================',
    '// LINKAGE LAB - App render loop (requestRender, render, HUD, 2D fallback)',
    '// Depends on global: state, canvas, ctx, uiStats, uiCol, buildLinkageGeometry, renderThreeJS',
    '// ============================================================================',
    '(function (g) {',
    "    'use strict';",
    ''
)
$footer = @(
    '',
    '    g.LinkageModules = g.LinkageModules || {};',
    '    g.LinkageModules.renderApp = { requestRender, render, updateHUD };',
    ''
)
foreach ($name in $exportNames) {
    $footer += "    g.$name = $name;"
}
$footer += @('', '})(window);', '')

$indented = $chunk | ForEach-Object { "    $_" }
$all = $header + $indented + $footer

$outPath = Join-Path $root 'js\linkage\render-app.js'
[System.IO.File]::WriteAllLines($outPath, $all, [System.Text.UTF8Encoding]::new($false))
Write-Host "Wrote $($all.Count) lines to $outPath"

$stripLines = [System.Collections.Generic.HashSet[int]]::new()
foreach ($r in $ranges) {
    for ($ln = $r.Start; $ln -le $r.End; $ln++) { [void]$stripLines.Add($ln) }
}

$tempPath = "$indexPath.tmp"
$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($stripLines.Contains($ln)) {
        if ($ln -eq 3041) {
            $out.Add('// App render loop (requestRender, render, HUD, 2D fallback) - js/linkage/render-app.js')
            $out.Add('')
        }
        continue
    }
    $out.Add($lines[$i])
}
[System.IO.File]::WriteAllLines($tempPath, $out, [System.Text.UTF8Encoding]::new($false))
Move-Item -Path $tempPath -Destination $indexPath -Force
Write-Host "Stripped index.html: $($lines.Count) -> $($out.Count) lines"
