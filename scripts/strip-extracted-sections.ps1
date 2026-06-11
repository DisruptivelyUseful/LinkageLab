# Remove linkage code sections already extracted to js/linkage/*.js
# Processes index.html line-by-line (safe for large files).

$ErrorActionPreference = 'Stop'
$indexPath = Join-Path $PSScriptRoot '..\index.html'
$tempPath = "$indexPath.tmp"

# Each rule: on Start line, emit Replace (if any) then skip until End line.
# IncludeEnd=$true keeps the End line in output.
$rules = @(
    @{
        Start   = '// CONSTANTS & CONFIGURATION'
        End     = '/** Get current bolt radius from state */'
        Replace = @('// Constants — js/linkage/constants.js', '')
        IncludeEnd = $true
    },
    @{
        Start   = '/** Minimum safe height/width to prevent division by zero */'
        End     = '// Canvas setup - get references to both 2D overlay and WebGL canvases'
        Replace = @()
        IncludeEnd = $true
    },
    @{
        Start   = '// UTILITY FUNCTIONS'
        End     = '// STATE MANAGEMENT'
        Replace = @(
            '// Math & utilities — js/linkage/math.js',
            '',
            '// ============================================================================',
            '// STATE MANAGEMENT',
            '// ============================================================================'
        )
        IncludeEnd = $false
    },
    @{
        Start   = '// MATH UTILITIES - 3D Vector Operations'
        End     = '// RAY CASTING UTILITIES'
        Replace = @(
            '// ============================================================================',
            '// RAY CASTING UTILITIES',
            '// ============================================================================'
        )
        IncludeEnd = $false
    },
    @{
        Start   = '// GEOMETRY CLASSES'
        End     = '// RENDERER - Performance Optimized'
        Replace = @(
            '// Geometry classes — js/linkage/geometry-classes.js',
            '// Linkage solver — js/linkage/solver.js',
            '',
            '// ============================================================================',
            '// RENDERER - Performance Optimized',
            '// ============================================================================'
        )
        IncludeEnd = $false
    },
    @{
        Start   = '// COLLISION DETECTION'
        End     = '// EXPORT FUNCTIONS'
        Replace = @(
            '// Collision detection — js/linkage/collision.js',
            '',
            '// ============================================================================',
            '// EXPORT FUNCTIONS',
            '// ============================================================================'
        )
        IncludeEnd = $false
    },
    @{
        Start   = '// UNDO/REDO SYSTEM'
        End     = '// STATE MANAGEMENT'
        Replace = @(
            '// Cache, collision helpers, undo/redo — js/linkage/cache.js, js/linkage/history.js',
            '',
            '// ============================================================================',
            '// STATE MANAGEMENT',
            '// ============================================================================'
        )
        IncludeEnd = $false
    }
)

$activeRule = $null
$skipDecorators = $false
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
                # Skip decorator lines immediately above section title if present
                break
            }
        }
        if ($matched) { continue }

        # Skip === lines that precede a section start on next iteration — handled by rule Start match on title line only
        $writer.WriteLine($line)
        $outCount++
    }
}
finally {
    $reader.Close()
    $writer.Close()
}

Move-Item -Path $tempPath -Destination $indexPath -Force
Write-Host "Done. Output lines: $outCount"
