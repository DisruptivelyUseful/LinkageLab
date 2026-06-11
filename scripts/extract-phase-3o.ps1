# Phase 3o: app state, DOM setup, hardware UI init, main bootstrap
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

function Write-TopLevelModule {
    param([string]$Path, [string]$Title, [string]$Depends, [string[]]$Chunk)
    $header = @(
        '// ============================================================================',
        "// LINKAGE LAB - $Title",
        "// $Depends",
        '// ============================================================================',
        ''
    )
    $all = $header + $Chunk + ''
    [IO.File]::WriteAllLines($Path, $all, [Text.UTF8Encoding]::new($false))
    Write-Host "Wrote $($all.Count) lines to $Path"
}

function Write-InitModule {
    param([string]$Path, [string]$Title, [string]$Depends, [string[]]$Chunk, [string]$InitFn)
    $header = @(
        '// ============================================================================',
        "// LINKAGE LAB - $Title",
        "// $Depends",
        '// ============================================================================',
        '(function (g) {',
        "    'use strict';",
        ''
    )
    $body = $Chunk | ForEach-Object { "    $_" }
    $footer = @(
        '',
        "    function $InitFn() {",
        '        initAutoLumberPricing();',
        '        initBracketConfig();',
        '        initBoltConfig();',
        '        initWasherConfig();',
        '    }',
        '',
        '    g.LinkageModules = g.LinkageModules || {};',
        "    g.LinkageModules.hardwareUiInit = { $InitFn, updateBracketHoleDistance };",
        "    g.$InitFn = $InitFn;",
        '    g.updateBracketHoleDistance = updateBracketHoleDistance;',
        '',
        '})(window);',
        ''
    )
    [IO.File]::WriteAllLines($Path, ($header + $body + $footer), [Text.UTF8Encoding]::new($false))
    Write-Host "Wrote init module to $Path"
}

function Write-MainModule {
    param([string]$Path, [string[]]$Chunk)
    $header = @(
        '// ============================================================================',
        '// LINKAGE LAB - Application bootstrap (init orchestration, config load, autosave)',
        '// Depends on all linkage modules loaded before this script.',
        '// ============================================================================',
        '(function (g) {',
        "    'use strict';",
        '',
        '    function initLinkageLab() {',
        ''
    )
    $body = $Chunk | ForEach-Object { "        $_" }
    $footer = @(
        '    }',
        '',
        '    g.LinkageModules = g.LinkageModules || {};',
        '    g.LinkageModules.main = { initLinkageLab };',
        '    g.initLinkageLab = initLinkageLab;',
        '',
        '    if (document.readyState === ''loading'') {',
        '        document.addEventListener(''DOMContentLoaded'', initLinkageLab);',
        '    } else {',
        '        initLinkageLab();',
        '    }',
        '',
        '})(window);',
        ''
    )
    [IO.File]::WriteAllLines($Path, ($header + $body + $footer), [Text.UTF8Encoding]::new($false))
    Write-Host "Wrote main module to $Path"
}

# --- Locate blocks (1-based) ---
$stateStart = 0; $stateEnd = 0
$domCanvasStart = 0; $domCanvasEnd = 0
$domInputsStart = 0; $domInputsEnd = 0
$hwStart = 0; $hwEnd = 0
$hwBracketStart = 0; $hwBracketEnd = 0
$mainStart = 0; $mainEnd = 0

for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($lines[$i] -eq '/** Application state object containing all configuration parameters */') { $stateStart = $ln }
    if ($stateStart -gt 0 -and $stateEnd -eq 0 -and $lines[$i] -eq '// Input validation - js/linkage/validation.js') { $stateEnd = $ln - 2 }

    if ($lines[$i] -eq '// Canvas setup - get references to both 2D overlay and WebGL canvases') { $domCanvasStart = $ln }
    if ($domCanvasStart -gt 0 -and $domCanvasEnd -eq 0 -and $lines[$i] -eq 'const canvasWebGL = document.getElementById(''canvas-webgl'');') { $domCanvasEnd = $ln }

    if ($lines[$i] -eq '// DOM ELEMENTS') { $domInputsStart = $ln - 1 }
    if ($domInputsStart -gt 0 -and $domInputsEnd -eq 0 -and $lines[$i] -eq '// Geometry classes - js/linkage/geometry-classes.js') { $domInputsEnd = $ln - 2 }

    if ($lines[$i] -eq '// Auto lumber pricing controls') { $hwStart = $ln + 1 }
    if ($hwStart -gt 0 -and $hwEnd -eq 0 -and $lines[$i] -eq '// Viewport navigation & SpaceMouse - js/linkage/viewport-input.js') { $hwEnd = $ln - 1 }

    if ($lines[$i] -eq '// Update bracket hole position display') { $hwBracketStart = $ln }
    if ($hwBracketStart -gt 0 -and $hwBracketEnd -eq 0 -and $lines[$i] -eq '// Initialize solar panel arch mode UI') { $hwBracketEnd = $ln - 1 }

    if ($lines[$i] -eq '// INITIALIZATION') { $mainStart = $ln + 1 }
    if ($mainStart -gt 0 -and $mainEnd -eq 0 -and $lines[$i] -eq '</script>') { $mainEnd = $ln - 1 }
}

if ($stateStart -eq 0 -or $stateEnd -eq 0) { throw "state block: $stateStart-$stateEnd" }
if ($domCanvasStart -eq 0 -or $domInputsEnd -eq 0) { throw "dom block: canvas=$domCanvasStart-$domCanvasEnd inputs=$domInputsStart-$domInputsEnd" }
if ($hwStart -eq 0 -or $hwEnd -eq 0) { throw "hw lumber block: $hwStart-$hwEnd" }
if ($hwBracketStart -eq 0 -or $hwBracketEnd -eq 0) { throw "hw bracket block: $hwBracketStart-$hwBracketEnd" }
if ($mainStart -eq 0 -or $mainEnd -eq 0) { throw "main block: $mainStart-$mainEnd" }

Write-Host "state: $stateStart-$stateEnd"
Write-Host "dom canvas: $domCanvasStart-$domCanvasEnd, dom inputs: $domInputsStart-$domInputsEnd"
Write-Host "hw lumber: $hwStart-$hwEnd, hw bracket: $hwBracketStart-$hwBracketEnd"
Write-Host "main: $mainStart-$mainEnd"

$stateChunk = $lines[($stateStart - 1)..($stateEnd - 1)]
$domChunk = $lines[($domCanvasStart - 1)..($domCanvasEnd - 1)] + '' + $lines[($domInputsStart - 1)..($domInputsEnd - 1)]
$hwLumberChunk = $lines[($hwStart - 1)..($hwEnd - 1)]
$hwBracketChunk = $lines[($hwBracketStart - 1)..($hwBracketEnd - 1)]

# Transform lumber IIFE -> named function for hardware module
$hwBody = [System.Collections.Generic.List[string]]::new()
foreach ($line in $hwLumberChunk) {
    if ($line -eq '(function initAutoLumberPricing() {') {
        [void]$hwBody.Add('function initAutoLumberPricing() {')
        continue
    }
    if ($line -eq '})();') { [void]$hwBody.Add('}'); continue }
    [void]$hwBody.Add($line)
}
foreach ($line in $hwBracketChunk) {
    if ($line -match '^\(function init(\w+)\(\) \{') {
        [void]$hwBody.Add("function init$($Matches[1])() {")
        continue
    }
    if ($line -eq '})();') { [void]$hwBody.Add('}'); continue }
    [void]$hwBody.Add($line)
}

$mainRaw = $lines[($mainStart - 1)..($mainEnd - 1)]
$mainChunk = [System.Collections.Generic.List[string]]::new()
$skip = $false
foreach ($line in $mainRaw) {
    if ($line -eq '// Update bracket hole position display') { $skip = $true; continue }
    if ($skip) {
        if ($line -eq '// Initialize solar panel arch mode UI') { $skip = $false }
        else { continue }
    }
    [void]$mainChunk.Add($line)
}
# Insert hardware UI init call after initUIBindings
$mainOut = [System.Collections.Generic.List[string]]::new()
foreach ($line in $mainChunk) {
    [void]$mainOut.Add($line)
    if ($line -eq 'initUIBindings();') { [void]$mainOut.Add('initHardwareUI();') }
}

Write-TopLevelModule -Path (Join-Path $root 'js\linkage\app-state.js') `
    -Title 'Application state object and light vector' `
    -Depends 'Load after hardware-detail.js (getDefaultHardwareAssemblies)' `
    -Chunk $stateChunk

Write-TopLevelModule -Path (Join-Path $root 'js\linkage\dom-setup.js') `
    -Title 'Canvas, idMap, inputs, and HUD element references' `
    -Depends 'Load after state-sync.js; calls initSliderBindings()' `
    -Chunk $domChunk

Write-InitModule -Path (Join-Path $root 'js\linkage\hardware-ui-init.js') `
    -Title 'Hardware sidebar UI initialization (lumber pricing, bracket, bolt, washer)' `
    -Depends 'Depends on global: state, unitConverter, formatNumber, updateAutoBoltLengths, calculateTotalVBeamWidth' `
    -Chunk $hwBody `
    -InitFn 'initHardwareUI'

Write-MainModule -Path (Join-Path $root 'js\linkage\main.js') -Chunk $mainOut

# Strip index.html inline blocks
$ranges = @(
    @{ Start = $stateStart; End = $stateEnd; Placeholder = '// Application state - js/linkage/app-state.js' },
    @{ Start = $domCanvasStart; End = $domCanvasEnd; Placeholder = '// Canvas + DOM setup - js/linkage/dom-setup.js (canvas refs)' },
    @{ Start = $domInputsStart; End = $domInputsEnd; Placeholder = '' },
    @{ Start = $hwStart - 1; End = $hwEnd; Placeholder = '// Hardware UI init - js/linkage/hardware-ui-init.js' },
    @{ Start = $hwBracketStart; End = $hwBracketEnd; Placeholder = '' },
    @{ Start = $mainStart - 1; End = $mainEnd; Placeholder = '// App bootstrap - js/linkage/main.js' }
)

$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    $skip = $false
    foreach ($r in $ranges) {
        if ($r.Start -le 0 -or $r.End -le 0) { continue }
        if ($ln -ge $r.Start -and $ln -le $r.End) {
            if ($ln -eq $r.Start -and $r.Placeholder) { $out.Add($r.Placeholder); $out.Add('') }
            $skip = $true
            break
        }
    }
    if (-not $skip) { $out.Add($lines[$i]) }
}

# Collapse duplicate canvas placeholder
$collapsed = [System.Collections.Generic.List[string]]::new()
$prev = ''
foreach ($line in $out) {
    if ($line -eq '// Canvas + DOM setup - js/linkage/dom-setup.js (canvas refs)' -and $prev -eq $line) { continue }
    $collapsed.Add($line)
    $prev = $line
}

$temp = "$indexPath.tmp"
[IO.File]::WriteAllLines($temp, $collapsed, [Text.UTF8Encoding]::new($false))
Move-Item $temp $indexPath -Force
Write-Host "Stripped index.html: $($lines.Count) -> $($collapsed.Count) lines"
