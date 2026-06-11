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
