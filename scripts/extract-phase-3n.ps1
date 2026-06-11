# Phase 3n: beam-bolt helpers, validation, export bridge, UI bindings
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

function Get-FunctionNames([string[]]$Chunk) {
    $names = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $Chunk) {
        if ($line -match '^function\s+(\w+)\s*\(') { [void]$names.Add($Matches[1]) }
    }
    return $names | Select-Object -Unique
}

function Write-SimpleModule {
    param([string]$Path, [string]$Title, [string]$ModuleKey, [string]$Depends, [string[]]$Chunk, [string[]]$ExtraExports = @())
    $names = Get-FunctionNames $Chunk
    if ($Chunk -match 'const VALIDATION_RULES') { $ExtraExports = @('VALIDATION_RULES') + $ExtraExports }
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
    $exports = ($names + $ExtraExports) | Select-Object -Unique
    $exportList = $exports -join ', '
    $footer = @(
        '',
        '    g.LinkageModules = g.LinkageModules || {};',
        ('    g.LinkageModules.' + $ModuleKey + ' = { ' + $exportList + ' };')
    )
    foreach ($n in $exports) {
        if ($n -eq 'VALIDATION_RULES') { $footer += '    g.VALIDATION_RULES = VALIDATION_RULES;' }
        else { $footer += ('    g.' + $n + ' = ' + $n + ';') }
    }
    $footer += @('', '})(window);', '')
    $all = $header + $body + $footer
    [IO.File]::WriteAllLines($Path, $all, [Text.UTF8Encoding]::new($false))
    Write-Host "Wrote $($all.Count) lines to $Path"
}

function Split-FunctionsAndBindings([string[]]$Chunk) {
    $functions = [System.Collections.Generic.List[string]]::new()
    $bindings = [System.Collections.Generic.List[string]]::new()
    $i = 0
    while ($i -lt $Chunk.Count) {
        $line = $Chunk[$i]
        if ($line -match '^function\s+\w+\s*\(') {
            $fnLines = [System.Collections.Generic.List[string]]::new()
            $depth = 0
            $started = $false
            while ($i -lt $Chunk.Count) {
                $ln = $Chunk[$i]
                [void]$fnLines.Add($ln)
                $opens = ([regex]::Matches($ln, '\{')).Count
                $closes = ([regex]::Matches($ln, '\}')).Count
                if ($ln -match '\{') { $started = $true }
                $depth += $opens - $closes
                $i++
                if ($started -and $depth -le 0) { break }
            }
            foreach ($fl in $fnLines) { [void]$functions.Add($fl) }
            continue
        }
        [void]$bindings.Add($line)
        $i++
    }
    return @{ Functions = $functions; Bindings = $bindings }
}

function Write-UiBindingsModule {
    param([string[]]$Chunk)
    $filtered = $Chunk | Where-Object {
        $_ -notmatch '^let solarDesignerLoadPromise' -and
        $_ -notmatch '^let currentAppMode' -and
        $_ -notmatch '^let panelSyncTimeout' -and
        $_ -notmatch '^window\.debouncedPanelSync'
    }
    $split = Split-FunctionsAndBindings $filtered
    $fnNames = Get-FunctionNames $split.Functions
    $moduleExports = $fnNames + @('initUIBindings', 'currentAppMode')
    $header = @(
        '// ============================================================================',
        '// LINKAGE LAB - UI event bindings (keyboard, sidebar, support beams, mode switch)',
        '// Depends on global: state, canvas, unitConverter, idMap, inputs, and most linkage modules',
        '// Call initUIBindings() from INITIALIZATION after state/canvas/idMap are defined.',
        '// ============================================================================',
        '(function (g) {',
        "    'use strict';",
        '',
        '    let solarDesignerLoadPromise = null;',
        '    let currentAppMode = ''linkage'';',
        '    let panelSyncTimeout = null;',
        ''
    )
    $fnBody = $split.Functions | ForEach-Object { "    $_" }
    $bindBody = $split.Bindings | ForEach-Object { "        $_" }
    $middle = @(
        '',
        '    function initUIBindings() {',
        ''
    ) + $bindBody + @(
        '    }',
        ''
    )
    $footer = @(
        '    g.LinkageModules = g.LinkageModules || {};',
        "    g.LinkageModules.uiBindings = { $($moduleExports -join ', ') };"
    )
    foreach ($n in $fnNames) { $footer += "    g.$n = $n;" }
    $footer += @(
        '    g.initUIBindings = initUIBindings;',
        '    Object.defineProperty(g, ''currentAppMode'', {',
        '        get() { return currentAppMode; },',
        '        set(v) { currentAppMode = v; }',
        '    });',
        '    g.debouncedPanelSync = debouncedPanelSync;',
        '    g.ensureSolarDesignerLoaded = ensureSolarDesignerLoaded;',
        '',
        '})(window);',
        ''
    )
    $all = $header + $fnBody + $middle + $footer
    $path = Join-Path $root 'js\linkage\ui-bindings.js'
    [IO.File]::WriteAllLines($path, $all, [Text.UTF8Encoding]::new($false))
    Write-Host "Wrote $($all.Count) lines to $path"
}

# --- Locate blocks (1-based line numbers) ---
$beamStart = 0; $beamEnd = 0
$valStart = 0; $valEnd = 0
$exportStart = 0; $exportEnd = 0
$uiStart = 0; $uiEnd = 0
$beamDone = $false; $exportDone = $false

for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($lines[$i] -match '^function getBoltRadius\(') { $beamStart = $ln }
    if ($beamStart -gt 0 -and $beamEnd -eq 0 -and $lines[$i] -eq '// Canvas setup - get references to both 2D overlay and WebGL canvases') { $beamEnd = $ln - 1 }
    if ($lines[$i] -eq '// Beam/bolt/V-stack helpers - js/linkage/beam-bolt-helpers.js') { $beamDone = $true }

    if ($lines[$i] -eq '// ============================================================================' -and ($i + 1) -lt $lines.Count -and $lines[$i + 1] -eq '// INPUT VALIDATION') { $valStart = $ln }
    if ($valStart -gt 0 -and $valEnd -eq 0 -and $lines[$i] -match '// showToast\(\).*provided by js/core/feedback') { $valEnd = $ln - 1 }

    if ($lines[$i] -match '^function generateDefaultFilename\(') { $exportStart = $ln }
    if ($exportStart -gt 0 -and $exportEnd -eq 0 -and $lines[$i] -eq '// Build guide (BOM, PDF/CSV, drill templates) - js/linkage/build-guide.js') { $exportEnd = $ln - 1 }
    if ($lines[$i] -eq '// Export/import bridge - js/linkage/export-bridge.js') { $exportDone = $true }

    if ($lines[$i] -eq '// Keyboard shortcuts') { $uiStart = $ln }
    if ($uiStart -gt 0 -and $uiEnd -eq 0 -and $lines[$i] -match '^// =+$' -and ($i + 1) -lt $lines.Count -and $lines[$i + 1] -eq '// INITIALIZATION') { $uiEnd = $ln - 1 }
}

if ($valStart -eq 0 -or $valEnd -eq 0 -or $uiStart -eq 0 -or $uiEnd -eq 0) {
    throw "Block markers missing: val=$valStart-$valEnd ui=$uiStart-$uiEnd"
}
if (-not $beamDone -and ($beamStart -eq 0 -or $beamEnd -eq 0)) {
    throw "Beam block markers missing: beam=$beamStart-$beamEnd"
}
if (-not $exportDone -and ($exportStart -eq 0 -or $exportEnd -eq 0)) {
    throw "Export block markers missing: export=$exportStart-$exportEnd"
}

Write-Host "beam-bolt: $(if ($beamDone) { 'already stripped' } else { "$beamStart-$beamEnd" })"
Write-Host "validation: $valStart-$valEnd"
Write-Host "export: $(if ($exportDone) { 'already stripped' } else { "$exportStart-$exportEnd" })"
Write-Host "ui-bindings: $uiStart-$uiEnd"

if (-not $beamDone) {
    $beamChunk = $lines[($beamStart - 1)..($beamEnd - 1)]
    Write-SimpleModule -Path (Join-Path $root 'js\linkage\beam-bolt-helpers.js') `
        -Title 'Beam, bolt, and V-stack dimension helpers' `
        -ModuleKey 'beamBoltHelpers' `
        -Depends 'Depends on global: state, unitConverter, formatNumber, setInputDisplay, requestRender, invalidateGeometryCache' `
        -Chunk $beamChunk
}

$valChunk = $lines[($valStart - 1)..($valEnd - 1)]
Write-SimpleModule -Path (Join-Path $root 'js\linkage\validation.js') `
    -Title 'Input validation rules and validateInput()' `
    -ModuleKey 'validation' `
    -Depends 'Depends on global: clamp' `
    -Chunk $valChunk

if (-not $exportDone) {
    $exportChunk = $lines[($exportStart - 1)..($exportEnd - 1)]
    Write-SimpleModule -Path (Join-Path $root 'js\linkage\export-bridge.js') `
        -Title 'JSON export/import and Solar Simulator bridge' `
        -ModuleKey 'exportBridge' `
        -Depends 'Depends on global: state, buildLinkageGeometry, getUnifiedConfig, applyConfig, showToast, attachGlbToLinkageExport, SolarDesigner' `
        -Chunk $exportChunk
}

$uiChunk = $lines[($uiStart - 1)..($uiEnd - 1)]
Write-UiBindingsModule -Chunk $uiChunk

$ranges = [System.Collections.Generic.List[hashtable]]::new()
if (-not $beamDone) {
    [void]$ranges.Add(@{ Start = $beamStart; End = $beamEnd; Placeholder = '// Beam/bolt/V-stack helpers - js/linkage/beam-bolt-helpers.js' })
}
[void]$ranges.Add(@{ Start = $valStart; End = $valEnd; Placeholder = '// Input validation - js/linkage/validation.js' })
if (-not $exportDone) {
    [void]$ranges.Add(@{ Start = $exportStart; End = $exportEnd; Placeholder = '// Export/import bridge - js/linkage/export-bridge.js' })
}
[void]$ranges.Add(@{ Start = $uiStart; End = $uiEnd; Placeholder = '// UI event bindings - js/linkage/ui-bindings.js' })

$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    $skip = $false
    foreach ($r in $ranges) {
        if ($ln -ge $r.Start -and $ln -le $r.End) {
            if ($ln -eq $r.Start) { $out.Add($r.Placeholder); $out.Add('') }
            $skip = $true
            break
        }
    }
    if (-not $skip) { $out.Add($lines[$i]) }
}

$temp = "$indexPath.tmp"
[IO.File]::WriteAllLines($temp, $out, [Text.UTF8Encoding]::new($false))
Move-Item $temp $indexPath -Force
Write-Host "Stripped index.html: $($lines.Count) -> $($out.Count) lines"
