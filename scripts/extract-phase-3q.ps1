# Phase 3q: extract app chrome to partials/linkage-app.html and thin index.html shell
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
# Phase 3r splits linkage-app.html into topbar / sidebar / workspace partials.
$partialPath = Join-Path $root 'partials\linkage-app.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

$appStart = 0
$appEnd = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($lines[$i] -eq '<div id="topbar" class="topbar">') { $appStart = $ln }
    if ($appStart -gt 0 -and $appEnd -eq 0 -and $lines[$i] -eq '</div>' -and ($i + 2) -lt $lines.Count -and $lines[$i + 2] -match 'module-loader\.js') {
        $appEnd = $ln
    }
}
if ($appStart -eq 0 -or $appEnd -eq 0) { throw "App chrome markers missing: $appStart-$appEnd" }

$chunk = $lines[($appStart - 1)..($appEnd - 1)]
[IO.File]::WriteAllLines($partialPath, $chunk, [Text.UTF8Encoding]::new($false))
Write-Host "Wrote $($chunk.Count) lines to $partialPath"

$headEnd = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -eq '</head>') { $headEnd = $i; break }
}
if ($headEnd -eq 0) { throw '</head> not found' }
$head = $lines[0..$headEnd]
$tail = @(
    '<body>',
    '',
    '<div id="linkage-app-mount"></div>',
    '',
    '<script type="module" src="js/linkage/bootstrap.js"></script>',
    '',
    '</body>',
    '</html>',
    ''
)
$out = $head + $tail
[IO.File]::WriteAllLines($indexPath, $out, [Text.UTF8Encoding]::new($false))
Write-Host "Thinned index.html: $($lines.Count) -> $($out.Count) lines"

$splitScript = Join-Path $PSScriptRoot 'extract-phase-3r.ps1'
if (Test-Path $splitScript) {
    & $splitScript
}
