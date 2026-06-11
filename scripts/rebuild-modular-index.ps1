# Rebuild modular index.html from monolithic git version (marker-based strip)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$tempPath = "$indexPath.tmp"

$rules = @(
    @{
        Start   = '// CONSTANTS & CONFIGURATION'
        End     = '/** Get current bolt radius from state */'
        Replace = @('// Constants - js/linkage/constants.js', '')
        IncludeEnd = $true
    },
    @{
        Start   = '// THREE.JS RENDERER SYSTEM'
        End     = '// STATE MANAGEMENT'
        Replace = @(
            '// Three.js renderer - js/linkage/renderer-3d.js', '',
            '// Hardware Assembly Detail - js/linkage/hardware-detail.js', '',
            '// GLTF export - js/linkage/gltf-export.js', '',
            '// Scene render pipeline - js/linkage/scene-render.js', '',
            '// Math & utilities - js/linkage/math.js', ''
        )
        IncludeEnd = $false
    },
    @{
        Start   = '// MATH UTILITIES - 3D Vector Operations'
        End     = '// EXPORT FUNCTIONS'
        Replace = @(
            '// Geometry classes - js/linkage/geometry-classes.js',
            '// Linkage solver - js/linkage/solver.js', '',
            '// App render loop - js/linkage/render-app.js', '',
            '// Linkage geometry (solar panels, support beams) - js/linkage/linkage-geometry.js', '',
            '// Collision detection - js/linkage/collision.js', ''
        )
        IncludeEnd = $false
    },
    @{
        Start   = '// SAVE/LOAD & PRESETS'
        End     = '// ANIMATION SYSTEM'
        Replace = @('// Config persistence (save/load, presets) - js/linkage/config-persistence.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '// ANIMATION SYSTEM'
        End     = '// MEASUREMENT TOOLS'
        Replace = @('// Animation system - js/linkage/animation.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = 'function animateActuatorFold(targetAngle, duration = 3000, onComplete) {'
        End     = '// Actuator animation controls'
        Replace = @()
        IncludeEnd = $false
    },
    @{
        Start   = '// UNDO/REDO SYSTEM'
        End     = '/** Updates state with validation and error handling'
        Replace = @('// Cache, collision helpers, undo/redo - js/linkage/cache.js, js/linkage/history.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '/** Updates state with validation and error handling'
        End     = '// Auto lumber pricing controls'
        Replace = @('// State sync (updateState, syncUI, slider bindings) - js/linkage/state-sync.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '// Prevent sidebar/panel interactions from affecting canvas navigation'
        End     = '// Keyboard shortcuts'
        Replace = @('// Viewport navigation & SpaceMouse - js/linkage/viewport-input.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '// === SOLAR PANEL EVENT HANDLERS ==='
        End     = '// Support beams master toggle'
        Replace = @('// Solar panel event handlers - js/linkage/solar-panel-input.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = 'function computeReciprocalDrillData(data) {'
        End     = '// Config persistence (save/load, presets) - js/linkage/config-persistence.js'
        Replace = @('// Build guide (BOM, PDF/CSV, drill templates) - js/linkage/build-guide.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '// MEASUREMENT TOOLS'
        End     = '// Cache, collision helpers, undo/redo - js/linkage/cache.js, js/linkage/history.js'
        Replace = @('// Measurement tools, IBC & human scale - js/linkage/measurement-overlay.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = "document.getElementById('chk-measure').onchange = e => {"
        End     = '// Solar panel event handlers - js/linkage/solar-panel-input.js'
        Replace = @('// Measurement / IBC reference handlers - js/linkage/reference-input.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '/** Get current bolt radius from state */'
        End     = '// Canvas setup - get references to both 2D overlay and WebGL canvases'
        Replace = @('// Beam/bolt/V-stack helpers - js/linkage/beam-bolt-helpers.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '// INPUT VALIDATION'
        End     = '// showToast() — provided by js/core/feedback.js'
        Replace = @('// Input validation - js/linkage/validation.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = 'function generateDefaultFilename()'
        End     = '// Build guide (BOM, PDF/CSV, drill templates) - js/linkage/build-guide.js'
        Replace = @('// Export/import bridge - js/linkage/export-bridge.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '// Keyboard shortcuts'
        End     = "document.getElementById('btn-mode-solar').onclick = exportToSolarSimulator;"
        Replace = @('// UI event bindings - js/linkage/ui-bindings.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '/** Application state object containing all configuration parameters */'
        End     = '// INPUT VALIDATION'
        Replace = @('// Application state - js/linkage/app-state.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '// Canvas setup - get references to both 2D overlay and WebGL canvases'
        End     = '// Geometry classes - js/linkage/geometry-classes.js'
        Replace = @('// Canvas + DOM setup - js/linkage/dom-setup.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '(function initAutoLumberPricing()'
        End     = '// Viewport navigation & SpaceMouse - js/linkage/viewport-input.js'
        Replace = @('// Hardware UI init - js/linkage/hardware-ui-init.js', '')
        IncludeEnd = $false
    },
    @{
        Start   = '// Update bracket hole position display'
        End     = '// Initialize solar panel arch mode UI'
        Replace = @()
        IncludeEnd = $false
    },
    @{
        Start   = '// INITIALIZATION'
        End     = '})();'
        Replace = @('// App bootstrap - js/linkage/main.js', '')
        IncludeEnd = $false
    }
)

$activeRule = $null
$outCount = 0
$reader = [System.IO.StreamReader]::new($indexPath)
$writer = [System.IO.StreamWriter]::new($tempPath, $false, [System.Text.UTF8Encoding]::new($false))

try {
    while ($null -ne ($line = $reader.ReadLine())) {
        if ($null -ne $activeRule) {
            if ($line.Trim() -eq $activeRule.End) {
                if ($activeRule.IncludeEnd) {
                    foreach ($r in $activeRule.Replace) { $writer.WriteLine($r); $outCount++ }
                    $writer.WriteLine($line)
                    $outCount++
                } else {
                    foreach ($r in $activeRule.Replace) { $writer.WriteLine($r); $outCount++ }
                }
                $activeRule = $null
                continue
            }
            continue
        }

        $matched = $false
        foreach ($rule in $rules) {
            if ($line.Trim() -eq $rule.Start) {
                $activeRule = $rule
                $matched = $true
                break
            }
        }
        if ($matched) { continue }

        $writer.WriteLine($line)
        $outCount++
    }
}
finally {
    $reader.Close()
    $writer.Close()
}

Move-Item -Path $tempPath -Destination $indexPath -Force
Write-Host "Rebuilt index.html: $outCount lines"
