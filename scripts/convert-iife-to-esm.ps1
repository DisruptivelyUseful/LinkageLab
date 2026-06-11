# Convert linkage IIFE modules (function (g) { ... })(window) to ES modules
param(
    [string[]]$Files
)

$ErrorActionPreference = 'Stop'
$ReservedWords = @(
    'true', 'false', 'null', 'undefined', 'function', 'return', 'if', 'else',
    'catch', 'try', 'const', 'let', 'var', 'new', 'typeof', 'instanceof',
    'console', 'document', 'window', 'globalThis', 'g', 'get', 'set', 'configurable'
)

function Get-BridgeImportPath([string]$FilePath) {
    if ($FilePath -replace '\\', '/' -match 'js/core/') {
        return "../linkage/global-bridge.js"
    }
    return "./global-bridge.js"
}

function Add-ExportName([System.Collections.Generic.List[string]]$Names, [string]$Name) {
    if ([string]::IsNullOrWhiteSpace($Name)) { return }
    if ($Name -in $ReservedWords) { return }
    if (-not $Names.Contains($Name)) { [void]$Names.Add($Name) }
}

function Parse-LinkageModuleKeys([string]$Line) {
    $keys = [System.Collections.Generic.List[string]]::new()
    if ($Line -match 'g\.LinkageModules\.\w+\s*=\s*\{([^}]+)\}') {
        foreach ($part in ($Matches[1] -split ',')) {
            $k = $part.Trim()
            if ($k -match '^([A-Za-z_][A-Za-z0-9_]*)$') {
                [void]$keys.Add($Matches[1])
            }
        }
    }
    return $keys
}

function Convert-IifeFile([string]$Path) {
    $lines = [System.IO.File]::ReadAllLines($Path)
    $text = $lines -join "`n"
    if ($text -match "import \{ bridgeGlobals \}") {
        Write-Host "Skip (already ESM): $Path"
        return
    }

    $closeIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^\}\)\(window\);?\s*$') { $closeIdx = $i; break }
    }
    if ($closeIdx -lt 0) { throw "No IIFE close in $Path" }

    $scanStart = [Math]::Max(0, $closeIdx - 300)
    $footerStart = $null
    for ($i = $scanStart; $i -lt $closeIdx; $i++) {
        $trim = $lines[$i].Trim()
        if ($trim -match '^g\.' -or $trim -match '^Object\.defineProperty\(g') {
            $footerStart = $i
            break
        }
    }
    if ($null -eq $footerStart) { throw "No export footer in $Path" }

    $openIdx = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '\(function\s*\(g\)\s*\{') { $openIdx = $i; break }
    }
    if ($openIdx -lt 0) { throw "No IIFE open in $Path" }

    $bodyStart = $openIdx + 1
    if ($bodyStart -lt $lines.Count -and $lines[$bodyStart] -match "use strict") { $bodyStart++ }
    while ($bodyStart -lt $lines.Count -and [string]::IsNullOrWhiteSpace($lines[$bodyStart])) { $bodyStart++ }

    $body = [System.Collections.Generic.List[string]]::new()
    foreach ($line in $lines[$bodyStart..($footerStart - 1)]) { [void]$body.Add($line) }

    $exportNames = [System.Collections.Generic.List[string]]::new()
    $definePropertyLines = [System.Collections.Generic.List[string]]::new()
    $trailingBody = [System.Collections.Generic.List[string]]::new()
    $moduleName = $null
    $inDefine = $false
    $inModuleObj = $false

    for ($i = $footerStart; $i -lt $closeIdx; $i++) {
        $fl = $lines[$i]
        $trim = $fl.Trim()

        if ($inDefine) {
            [void]$definePropertyLines.Add(($fl -replace '\bg\b', 'globalThis'))
            if ($fl -match '\}\);?\s*$') { $inDefine = $false }
            continue
        }

        if ($trim -match '^Object\.defineProperty\(g,\s*[''"](\w+)[''"]') {
            Add-ExportName $exportNames $Matches[1]
            $inDefine = $true
            [void]$definePropertyLines.Add(($fl -replace '\bg\b', 'globalThis'))
            continue
        }

        if ($trim -match '^g\.LinkageModules\s*=') {
            continue
        }

        if ($trim -match '^g\.LinkageModules\.(\w+)\s*=') {
            $moduleName = $Matches[1]
            $inlineKeys = Parse-LinkageModuleKeys $fl
            foreach ($k in $inlineKeys) { Add-ExportName $exportNames $k }
            if ($trim -notmatch '\};?\s*$') { $inModuleObj = $true }
            continue
        }

        if ($inModuleObj) {
            if ($trim -match '^\};?\s*$') {
                $inModuleObj = $false
                continue
            }
            if ($trim -match '^([A-Za-z_][A-Za-z0-9_]*)\s*,?\s*$') {
                Add-ExportName $exportNames $Matches[1]
            }
            continue
        }

        if ($trim -match '^g\.(\w+)\s*=\s*(\w+)\s*;?\s*$') {
            Add-ExportName $exportNames $Matches[1]
            continue
        }

        if ([string]::IsNullOrWhiteSpace($fl)) {
            if ($trailingBody.Count -gt 0) { [void]$trailingBody.Add($fl) }
            continue
        }

        [void]$trailingBody.Add($fl)
    }

    if ($exportNames.Count -eq 0) { throw "No exports found in $Path" }

    if ($trailingBody.Count -gt 0) {
        if ($body.Count -gt 0 -and -not [string]::IsNullOrWhiteSpace($body[$body.Count - 1])) {
            [void]$body.Add('')
        }
        foreach ($line in $trailingBody) { [void]$body.Add($line) }
    }

    $bridgePath = Get-BridgeImportPath $Path
    $titleLine = $lines[0]
    if ($titleLine -notmatch 'ES module') { $titleLine = "$titleLine (ES module)" }

    $out = [System.Collections.Generic.List[string]]::new()
    [void]$out.Add($titleLine)
    [void]$out.Add('')
    [void]$out.Add("import { bridgeGlobals } from '$bridgePath';")
    [void]$out.Add('')
    foreach ($line in $body) { [void]$out.Add($line) }
    [void]$out.Add('')
    [void]$out.Add('const _moduleExports = {')
    foreach ($name in $exportNames) { [void]$out.Add("    $name,") }
    [void]$out.Add('};')
    [void]$out.Add('')
    foreach ($line in $definePropertyLines) { [void]$out.Add($line) }
    if ($definePropertyLines.Count -gt 0) { [void]$out.Add('') }
    if ($moduleName) {
        [void]$out.Add("bridgeGlobals(_moduleExports, '$moduleName');")
    } else {
        [void]$out.Add('bridgeGlobals(_moduleExports);')
    }
    [void]$out.Add('')
    [void]$out.Add("export { $($exportNames -join ', ') };")

    $utf = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllLines($Path, $out, $utf)
    Write-Host "Converted $Path ($($exportNames.Count) exports)"
}

$root = Split-Path $PSScriptRoot -Parent
if (-not $Files -or $Files.Count -eq 0) {
    $Files = @(
        'js/linkage/renderer-3d.js',
        'js/linkage/measurement-overlay.js',
        'js/linkage/gltf-export.js',
        'js/linkage/scene-render.js',
        'js/linkage/linkage-geometry.js',
        'js/linkage/export-bridge.js',
        'js/linkage/build-guide.js',
        'js/linkage/solar-panel-input.js',
        'js/linkage/render-app.js',
        'js/linkage/viewport-input.js',
        'js/linkage/validation.js',
        'js/linkage/state-sync.js',
        'js/linkage/reference-input.js',
        'js/linkage/ui-bindings.js',
        'js/linkage/hardware-ui-init.js',
        'js/linkage/main.js'
    )
}

foreach ($rel in $Files) {
    $full = Join-Path $root ($rel -replace '/', '\')
    Convert-IifeFile $full
}
