# Extract animation system from index.html (Phase 3i)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

$ranges = @(
    @{ Start = 7345; End = 7602 },
    @{ Start = 10539; End = 10620 }
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
    '// LINKAGE LAB - Animation (fold/unfold, actuator, closed-angle cache)',
    '// Depends on global: state, solveLinkage helpers, requestRender, syncUI, geometry-classes folding helpers',
    '// ============================================================================',
    '(function (g) {',
    "    'use strict';",
    ''
)
$footer = @(
    '',
    '    g.LinkageModules = g.LinkageModules || {};',
    '    g.LinkageModules.animation = {',
    '        updateAnimationStatus, getOptimalClosedAngleForAnimation, animateFold,',
    '        animateActuatorFold, stopActuatorAnimation',
    '    };',
    ''
)
foreach ($name in $exportNames) {
    $footer += "    g.$name = $name;"
}
$footer += @('', '})(window);', '')

$indented = $chunk | ForEach-Object { "    $_" }
$all = $header + $indented + $footer

$outPath = Join-Path $root 'js\linkage\animation.js'
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
        if ($ln -eq 7345) {
            $out.Add('// Animation system - js/linkage/animation.js')
            $out.Add('')
        }
        continue
    }
    $out.Add($lines[$i])
}
[System.IO.File]::WriteAllLines($tempPath, $out, [System.Text.UTF8Encoding]::new($false))
Move-Item -Path $tempPath -Destination $indexPath -Force
Write-Host "Stripped index.html: $($lines.Count) -> $($out.Count) lines"
