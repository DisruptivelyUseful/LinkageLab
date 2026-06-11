# Extract build guide, measurement/IBC overlay, and reference input handlers (Phase 3m)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

function Write-LinkageModule {
    param(
        [string]$Path,
        [string]$Title,
        [string]$ModuleKey,
        [string]$Depends,
        [string[]]$Chunk,
        [string[]]$Exports
    )
    $header = @(
        '// ============================================================================',
        "// LINKAGE LAB - $Title",
        "// $Depends",
        '// ============================================================================',
        '(function (g) {',
        "    'use strict';",
        ''
    )
    $body = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $Chunk) {
        $body.Add('    ' + $line)
    }

    $footer = @(
        '',
        '    g.LinkageModules = g.LinkageModules || {};',
        "    g.LinkageModules.$ModuleKey = { $($Exports -join ', ') };"
    )
    foreach ($name in $Exports) {
        if ($name -match '^init') { continue }
        $footer += "    g.$name = $name;"
    }
    foreach ($name in ($Exports | Where-Object { $_ -match '^init' })) {
        $footer += "    g.$name = $name;"
    }
    $footer += @('', '})(window);', '')

    $all = $header + $body + $footer
    [System.IO.File]::WriteAllLines($Path, $all, [Text.UTF8Encoding]::new($false))
    Write-Host "Wrote $($all.Count) lines to $Path"
}

# --- Locate blocks ---
$buildStart = 0; $buildEnd = 0
$measStart = 0; $measEnd = 0
$refStart = 0; $refEnd = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($buildStart -eq 0 -and $lines[$i] -match '^function computeReciprocalDrillData\(') { $buildStart = $i }
    if ($buildStart -gt 0 -and $buildEnd -eq 0 -and $lines[$i] -eq '// Config persistence (save/load, presets) - js/linkage/config-persistence.js') {
        $buildEnd = $i - 1
    }
    if ($measStart -eq 0 -and $lines[$i] -eq '// MEASUREMENT TOOLS') { $measStart = $i + 1 }
    if ($measStart -gt 0 -and $measEnd -eq 0 -and $lines[$i] -eq '// Cache, collision helpers, undo/redo - js/linkage/cache.js, js/linkage/history.js') {
        $measEnd = $i - 1
    }
    if ($lines[$i] -match "^document\.getElementById\('chk-measure'\)") { $refStart = $i + 1 }
    if ($refStart -gt 0 -and $refEnd -eq 0 -and $lines[$i] -eq 'syncIbcStackControlsVisibility();' -and ($i + 2) -lt $lines.Count -and $lines[$i + 2] -eq '// Solar panel event handlers - js/linkage/solar-panel-input.js') {
        $refEnd = $i + 1
    }
}

if ($buildStart -eq 0 -or $buildEnd -eq 0) { throw "Build guide block not found ($buildStart, $buildEnd)" }
if ($measStart -eq 0 -or $measEnd -eq 0) { throw "Measurement block not found ($measStart, $measEnd)" }
if ($refStart -eq 0 -or $refEnd -eq 0) { throw "Reference input block not found ($refStart, $refEnd)" }

Write-Host "Build guide: $buildStart-$($buildEnd - 1)"
Write-Host "Measurement: $measStart-$measEnd"
Write-Host "Reference input: $refStart-$refEnd"

$buildChunk = $lines[$buildStart..$buildEnd]
$measChunk = $lines[($measStart - 1)..($measEnd - 1)]
$refChunk = $lines[($refStart - 1)..($refEnd - 1)]

# Build guide: wrap modal listeners in initBuildGuideHandlers
$buildProcessed = [System.Collections.Generic.List[string]]::new()
$modalStart = -1
for ($i = 0; $i -lt $buildChunk.Count; $i++) {
    if ($buildChunk[$i] -eq '// Close modal when clicking outside content') { $modalStart = $i; break }
}
if ($modalStart -lt 0) { throw 'Build guide modal listener block not found' }
for ($i = 0; $i -lt $buildChunk.Count; $i++) {
    if ($i -eq $modalStart) {
        $buildProcessed.Add('function initBuildGuideHandlers() {')
    }
    if ($i -ge $modalStart) {
        $buildProcessed.Add('    ' + $buildChunk[$i])
    } else {
        $buildProcessed.Add($buildChunk[$i])
    }
}
$buildProcessed.Add('}')

$buildExports = @(
    'computeReciprocalDrillData', 'showBuildGuide', 'renderGuideView', 'renderBracketDiagram',
    'drawArrow', 'closeBuildGuide', 'exportGuideJSON', 'recalcGuideBOM', 'gatherBOMData',
    'exportGuidePDF', 'exportBOMcsv', 'exportBuildGuide', 'initBuildGuideHandlers'
)

Write-LinkageModule -Path (Join-Path $root 'js\linkage\build-guide.js') `
    -Title 'Build guide modal (BOM, PDF/CSV export, drill templates)' `
    -ModuleKey 'buildGuide' `
    -Depends 'Depends on global: state, buildLinkageGeometry, needsSplitVBolts, closestPointOnSegment3D, vMag, vSub, exportToJSON, showToast, unitConverter, formatNumber, jspdf' `
    -Chunk $buildProcessed `
    -Exports $buildExports

$measExports = @(
    'formatMeasurementSidebar', 'calculateMeasurements', 'drawMeasurements', 'drawMeasurementsOverlay',
    'applyIbcInteriorGlow', 'rebuildIbcPivotStack', 'createIbcExportGroup', 'syncIbcStackControlsVisibility',
    'getStructurePlanFootprintForReference', 'updateIbcGlbReference', 'updateHumanScaleFigure', 'update3DMeasurementLines'
)

Write-LinkageModule -Path (Join-Path $root 'js\linkage\measurement-overlay.js') `
    -Title 'Measurement tools, IBC reference stack, human scale figure' `
    -ModuleKey 'measurementOverlay' `
    -Depends 'Depends on global: state, THREE, threeRenderer, ibcGlbState, ibcStackLayoutCacheKey, unitConverter, formatNumber, INCHES_PER_FOOT, cloneIbcTemplateForExport, isMainStructureBeam, render, renderPending, showToast' `
    -Chunk $measChunk `
    -Exports $measExports

$refProcessed = @('function initReferenceInputHandlers() {') + ($refChunk | ForEach-Object { '    ' + $_ }) + @('}')

Write-LinkageModule -Path (Join-Path $root 'js\linkage\reference-input.js') `
    -Title 'Measurement / human scale / IBC sidebar handlers' `
    -ModuleKey 'referenceInput' `
    -Depends 'Depends on global: state, render, renderPending, requestRender, syncIbcStackControlsVisibility, INCHES_PER_METER' `
    -Chunk $refProcessed `
    -Exports @('initReferenceInputHandlers')

# Strip index.html
$ranges = @(
    @{ Start = $buildStart + 1; End = $buildEnd + 1; Placeholder = '// Build guide (BOM, PDF/CSV, drill templates) - js/linkage/build-guide.js' },
    @{ Start = $measStart; End = $measEnd; Placeholder = '// Measurement tools, IBC & human scale - js/linkage/measurement-overlay.js' },
    @{ Start = $refStart; End = $refEnd; Placeholder = '// Measurement / IBC reference handlers - js/linkage/reference-input.js' }
)

$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    $skip = $false
    foreach ($r in $ranges) {
        if ($ln -ge $r.Start -and $ln -le $r.End) {
            if ($ln -eq $r.Start) {
                $out.Add($r.Placeholder)
                $out.Add('')
            }
            $skip = $true
            break
        }
    }
    if (-not $skip) { $out.Add($lines[$i]) }
}

$tempPath = "$indexPath.tmp"
[System.IO.File]::WriteAllLines($tempPath, $out, [Text.UTF8Encoding]::new($false))
Move-Item -Path $tempPath -Destination $indexPath -Force
Write-Host "Stripped index.html: $($lines.Count) -> $($out.Count) lines"
