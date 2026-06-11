# Extract solar panel UI event handlers (Phase 3l)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

$startLine = 0
$endLine = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -eq '// === SOLAR PANEL EVENT HANDLERS ===') { $startLine = $i + 1 }
    if ($startLine -gt 0 -and $lines[$i] -match '^// Support beams master toggle') { $endLine = $i; break }
}
if ($startLine -eq 0 -or $endLine -eq 0) { throw "Could not find solar panel handler block markers" }

$chunk = $lines[($startLine - 1)..($endLine - 2)]
Write-Host "Extracting lines $startLine-$($endLine - 1) ($($chunk.Count) lines)"

$header = @(
    '// ============================================================================',
    '// LINKAGE LAB - Solar panel sidebar event handlers',
    '// Depends on global: state, requestRender, invalidateGeometryCache, showToast,',
    '//   getOptimalClosedAngleForAnimation, radToDeg, updateArchWallFacesUI,',
    '//   generateWallFaceButtons, debouncedPanelSync',
    '// Call initSolarPanelHandlers() after DOM is ready (INITIALIZATION block).',
    '// ============================================================================',
    '(function (g) {',
    "    'use strict';",
    '',
    '    function initSolarPanelHandlers() {'
)
$footer = @(
    '    }',
    '',
    '    g.LinkageModules = g.LinkageModules || {};',
    '    g.LinkageModules.solarPanelInput = { initSolarPanelHandlers };',
    '    g.initSolarPanelHandlers = initSolarPanelHandlers;',
    '',
    '})(window);',
    ''
)

$indented = $chunk | ForEach-Object { "        $_" }
$all = $header + $indented + $footer

$outPath = Join-Path $root 'js\linkage\solar-panel-input.js'
[System.IO.File]::WriteAllLines($outPath, $all, [Text.UTF8Encoding]::new($false))
Write-Host "Wrote $($all.Count) lines to $outPath"

$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($ln -ge $startLine -and $ln -lt $endLine) {
        if ($ln -eq $startLine) {
            $out.Add('// Solar panel event handlers - js/linkage/solar-panel-input.js')
            $out.Add('')
        }
        continue
    }
    $out.Add($lines[$i])
}

$tempPath = "$indexPath.tmp"
[System.IO.File]::WriteAllLines($tempPath, $out, [Text.UTF8Encoding]::new($false))
Move-Item -Path $tempPath -Destination $indexPath -Force
Write-Host "Stripped index.html: $($lines.Count) -> $($out.Count) lines"
