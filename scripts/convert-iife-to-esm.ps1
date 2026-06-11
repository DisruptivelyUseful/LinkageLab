# Convert linkage IIFE modules (function (g) { ... })(window) to ES modules
param(
    [string[]]$Files
)

$ErrorActionPreference = 'Stop'

function Get-BridgeImportPath([string]$FilePath) {
    if ($FilePath -replace '\\', '/' -match 'js/core/') {
        return "../linkage/global-bridge.js"
    }
    return "./global-bridge.js"
}

function Convert-IifeFile([string]$Path) {
    $lines = [System.IO.File]::ReadAllLines($Path)
    $closeIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\}\)\(window\);?\s*$') { $closeIdx = $i; break }
    }
    if ($closeIdx -lt 0) { throw "No IIFE close in $Path" }

    $footerStart = $closeIdx
    while ($footerStart -gt 0) {
        $l = $lines[$footerStart - 1]
        $trim = $l.Trim()
        $isFooter = $false
        if ([string]::IsNullOrWhiteSpace($l)) { $isFooter = $true }
        elseif ($trim -match '^g\.') { $isFooter = $true }
        elseif ($trim -match '^Object\.defineProperty\(g,') { $isFooter = $true }
        elseif ($trim -match '^(get|set)\(\)') { $isFooter = $true }
        elseif ($trim -match '^configurable:') { $isFooter = $true }
        elseif ($trim -match '^},?\s*$' -or $trim -eq '};') { $isFooter = $true }
        elseif ($trim -match '^[A-Za-z_][A-Za-z0-9_]*,?\s*$') { $isFooter = $true }
        if ($isFooter) { $footerStart-- } else { break }
    }

    $openIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '\(function\s*\(g\)\s*\{') { $openIdx = $i; break }
    }
    if ($openIdx -lt 0) { throw "No IIFE open in $Path" }

    $bodyStart = $openIdx + 1
    if ($bodyStart -lt $lines.Count -and $lines[$bodyStart] -match "use strict") { $bodyStart++ }
    while ($bodyStart -lt $lines.Count -and [string]::IsNullOrWhiteSpace($lines[$bodyStart])) { $bodyStart++ }

    $body = $lines[$bodyStart..($footerStart - 1)]
    $footerLines = $lines[$footerStart..($closeIdx - 1)]

    $exportNames = [System.Collections.Generic.List[string]]::new()
    $definePropertyLines = [System.Collections.Generic.List[string]]::new()
    $moduleName = $null
    $inDefine = $false
    $inModuleObj = $false

    foreach ($fl in $footerLines) {
        if ($fl -match "Object\.defineProperty\(g,") {
            $inDefine = $true
            [void]$definePropertyLines.Add(($fl -replace '\bg\b', 'globalThis'))
            continue
        }
        if ($inDefine) {
            [void]$definePropertyLines.Add(($fl -replace '\bg\b', 'globalThis'))
            if ($fl -match '\}\);?\s*$') { $inDefine = $false }
            continue
        }
        if ($fl -match '^\s+g\.LinkageModules\.(\w+)\s*=\s*\{') {
            $moduleName = $Matches[1]
            $inModuleObj = $true
            continue
        }
        if ($inModuleObj) {
            if ($fl -match '^\s*\};?\s*$') { $inModuleObj = $false; continue }
            $keys = [regex]::Matches($fl, '\b([A-Za-z_][A-Za-z0-9_]*)\b') | ForEach-Object { $_.Value }
            foreach ($k in $keys) {
                if ($k -notin @('true', 'false', 'null') -and -not $exportNames.Contains($k)) {
                    [void]$exportNames.Add($k)
                }
            }
            continue
        }
        if ($fl -match '^\s+g\.(\w+)\s*=\s*(\w+)\s*;') {
            $name = $Matches[1]
            if (-not $exportNames.Contains($name)) { [void]$exportNames.Add($name) }
        }
    }

    if ($exportNames.Count -eq 0) { throw "No exports found in $Path" }

    $bridgePath = Get-BridgeImportPath $Path
    $header = @(
        ($lines[0] -replace '$', ' (ES module)'),
        '',
        "import { bridgeGlobals } from '$bridgePath';",
        ''
    )

    $exportObjLines = $exportNames | ForEach-Object { "    $_,`n" }
    $exportBlock = @(
        '',
        'const _moduleExports = {',
        (($exportNames | ForEach-Object { "    $_," }) -join "`n"),
        '};',
        ''
    )
    if ($definePropertyLines.Count -gt 0) {
        $exportBlock += $definePropertyLines
        $exportBlock += ''
    }
    if ($moduleName) {
        $exportBlock += "bridgeGlobals(_moduleExports, '$moduleName');"
    } else {
        $exportBlock += 'bridgeGlobals(_moduleExports);'
    }
    $exportBlock += ''
    $exportBlock += "export { $($exportNames -join ', ') };"

    $out = $header + $body + $exportBlock
    $utf = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllLines($Path, $out, $utf)
    Write-Host "Converted $Path ($($exportNames.Count) exports)"
}

foreach ($rel in $Files) {
    $full = Join-Path (Split-Path $PSScriptRoot -Parent) ($rel -replace '/', '\')
    Convert-IifeFile $full
}
