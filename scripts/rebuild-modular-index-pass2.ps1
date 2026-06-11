# Second pass: strip leftover inline blocks after first rebuild
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$tempPath = "$indexPath.tmp"

$rules = @(
    @{
        StartPattern = 'Exports the current 3D model to glTF/GLB format'
        End          = '// Math & utilities'
        Replace      = @('// GLTF export - js/linkage/gltf-export.js', '', '// Scene render pipeline - js/linkage/scene-render.js', '')
    },
    @{
        StartPattern = 'Finds a safe fold angle near the target angle where no collisions occur'
        End          = '// EXPORT FUNCTIONS'
        Replace      = @('// Collision detection — js/linkage/collision.js', '')
    },
    @{
        StartPattern = '^\s*\* Animates the fold/unfold sequence\s*$'
        End          = '// MEASUREMENT TOOLS'
        Replace      = @('// Animation system - js/linkage/animation.js', '')
    },
    @{
        StartPattern = '^function animateActuatorFold\('
        End          = '// Actuator animation controls'
        Replace      = @()
    },
    @{
        StartPattern = '^\s*\* Stops the actuator animation\s*$'
        End          = 'function stopActuatorAnimation'
        Replace      = @()
        IncludeEnd   = $true
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
                foreach ($r in $activeRule.Replace) { $writer.WriteLine($r); $outCount++ }
                if ($activeRule.IncludeEnd) { $writer.WriteLine($line); $outCount++ }
                $activeRule = $null
                continue
            }
            continue
        }

        $matched = $false
        foreach ($rule in $rules) {
            if ($line -match $rule.StartPattern) {
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

Write-Host "Pass2 done: $outCount lines"
