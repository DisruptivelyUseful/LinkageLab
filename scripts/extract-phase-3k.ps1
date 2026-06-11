# Extract updateState/syncUI and viewport/SpaceMouse handlers (Phase 3k)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

$stateStart = 7235
$stateEnd = 7432
$viewportStart = 7514
$viewportEnd = 7897

$stateChunk = $lines[($stateStart - 1)..($stateEnd - 1)]
$viewportChunk = $lines[($viewportStart - 1)..($viewportEnd - 1)]

# Wrap slider listeners in initSliderBindings()
$stateLines = [System.Collections.Generic.List[string]]::new()
$inListenerBlock = $false
foreach ($line in $stateChunk) {
    if ($line -eq '// Set up input event listeners with debouncing for sliders') {
        $stateLines.Add('    /** Binds idMap slider/number inputs to updateState (call after inputs{} is populated). */')
        $stateLines.Add('    function initSliderBindings() {')
        $inListenerBlock = $true
        continue
    }
    if ($inListenerBlock -and $line -eq '});') {
        $stateLines.Add('    });')
        $stateLines.Add('    }')
        $inListenerBlock = $false
        continue
    }
    if ($inListenerBlock) {
        $stateLines.Add('    ' + $line)
    } else {
        $stateLines.Add('    ' + $line)
    }
}

$stateExportNames = @('updateState', 'syncUI', 'initSliderBindings')

$stateHeader = @(
    '// ============================================================================',
    '// LINKAGE LAB - State sync (updateState, syncUI, slider bindings)',
    '// Depends on global: state, idMap, inputs, unitConverter, validateInput, showToast,',
    '//   syncLinkedVBeamDimensions, isVBeamDimensionsLinked, updateVBeamDimensionUIVisibility,',
    '//   updateAutoBoltLengths, generateWallFaceButtons, invalidateRcpCrossings,',
    '//   invalidateGeometryCache, solveLinkage, detectCollisions, findSafeFoldAngle,',
    '//   getOptimalClosedAngleForAnimation, updateAutoBeamPricing, saveStateToHistory,',
    '//   requestRender, debounce, DEBOUNCE_DELAY, formatNumber, degToRad, radToDeg,',
    '//   getEffectiveMinFoldAngle, MAX_FOLD_ANGLE, clamp',
    '// ============================================================================',
    '(function (g) {',
    "    'use strict';",
    ''
)
$stateFooter = @(
    '',
    '    g.LinkageModules = g.LinkageModules || {};',
    '    g.LinkageModules.stateSync = { updateState, syncUI, initSliderBindings };',
    '    g.updateState = updateState;',
    '    g.syncUI = syncUI;',
    '    g.initSliderBindings = initSliderBindings;',
    '',
    '})(window);',
    ''
)

$stateOut = Join-Path $root 'js\linkage\state-sync.js'
[System.IO.File]::WriteAllLines($stateOut, $stateHeader + $stateLines + $stateFooter, [Text.UTF8Encoding]::new($false))
Write-Host "Wrote state-sync.js: $($stateHeader.Count + $stateLines.Count + $stateFooter.Count) lines"

# Viewport: module-level drag/pinch, helpers, initViewportInput wraps listeners
$viewportLines = [System.Collections.Generic.List[string]]::new()
$skipUntil = -1
for ($i = 0; $i -lt $viewportChunk.Count; $i++) {
    $line = $viewportChunk[$i]
    $trim = $line.Trim()

    if ($trim -eq '// Prevent sidebar/panel interactions from affecting canvas navigation') {
        $viewportLines.Add('    function initViewportInput() {')
        $viewportLines.Add('        ' + $line.TrimStart())
        continue
    }
    if ($trim -eq '// Initialize SpaceMouse support') {
        $viewportLines.Add('        initSpaceMouse();')
        $viewportLines.Add('')
        $viewportLines.Add('        // Prevent context menu on right-click in viewport')
        $skipUntil = $i + 2
        continue
    }
    if ($i -eq $skipUntil) { continue }
    if ($trim -eq 'initSpaceMouse();') { continue }
    if ($trim -eq '// Prevent context menu on right-click in viewport') { continue }

    if ($trim -match '^const viewportElement') {
        $viewportLines.Add('        const viewportElement = document.getElementById(''viewport'');')
        continue
    }

    if ($trim -match '^viewportElement\.|^document\.addEventListener\(''mouseup''|^document\.addEventListener\(''mousemove''') {
        $viewportLines.Add('        ' + $line.TrimStart())
        continue
    }
    if ($trim -match '^\[''mousedown''') {
        $viewportLines.Add('        ' + $line.TrimStart())
        continue
    }
    if ($trim -match '^const sidebar|^const rightPanel') {
        $viewportLines.Add('        ' + $line.TrimStart())
        continue
    }

    $viewportLines.Add('    ' + $line)
}

if ($viewportLines[-1] -notmatch '^\s*\}\s*$') {
    $viewportLines.Add('    }')
}

$viewportHeader = @(
    '// ============================================================================',
    '// LINKAGE LAB - Viewport navigation (mouse/touch/wheel) and SpaceMouse',
    '// Depends on global: state, isFormElement (inline), autoSave, requestRender,',
    '//   solveLinkage, detectCollisions, findSafeFoldAngle, invalidateGeometryCache,',
    '//   syncUI, getEffectiveMinFoldAngle, MAX_FOLD_ANGLE, MIN_CAM_DIST, clamp',
    '// ============================================================================',
    '(function (g) {',
    "    'use strict';",
    '',
    '    g.drag = { active: false, x: 0, y: 0, mode: ''orbit'' };',
    '    g.pinch = { active: false, startDist: 0, startCamDist: 0, lastCenterX: 0, lastCenterY: 0 };',
    ''
)

$viewportFooter = @(
    '',
    '    g.LinkageModules = g.LinkageModules || {};',
    '    g.LinkageModules.viewportInput = { initViewportInput };',
    '    g.initViewportInput = initViewportInput;',
    '',
    '})(window);',
    ''
)

$viewportOut = Join-Path $root 'js\linkage\viewport-input.js'
[System.IO.File]::WriteAllLines($viewportOut, $viewportHeader + $viewportLines + $viewportFooter, [Text.UTF8Encoding]::new($false))
Write-Host "Wrote viewport-input.js: $($viewportHeader.Count + $viewportLines.Count + $viewportFooter.Count) lines"

# Strip from index.html (single pass, original line numbers)
$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($ln -ge $stateStart -and $ln -le $stateEnd) {
        if ($ln -eq $stateStart) {
            $out.Add('// State sync (updateState, syncUI, slider bindings) - js/linkage/state-sync.js')
            $out.Add('')
        }
        continue
    }
    if ($ln -ge $viewportStart -and $ln -le $viewportEnd) {
        if ($ln -eq $viewportStart) {
            $out.Add('// Viewport navigation & SpaceMouse - js/linkage/viewport-input.js')
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
