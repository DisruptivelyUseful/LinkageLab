$p = Join-Path (Split-Path $PSScriptRoot -Parent) 'js\linkage\build-guide.js'
$lines = [System.IO.File]::ReadAllLines($p)
$initStart = -1
$listenerEnd = -1
$chunkEnd = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -eq '    function initBuildGuideHandlers() {') { $initStart = $i }
    if ($initStart -ge 0 -and $listenerEnd -lt 0 -and $lines[$i] -match "e\.key === 'Escape'" ) {
        for ($j = $i; $j -lt $lines.Count; $j++) {
            if ($lines[$j] -eq '        });') { $listenerEnd = $j; break }
        }
    }
    if ($lines[$i] -eq '        // ============================================================================') { $chunkEnd = $i }
}
if ($initStart -lt 0 -or $listenerEnd -lt 0 -or $chunkEnd -lt 0) { throw "Markers not found ($initStart, $listenerEnd, $chunkEnd)" }

$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($i -eq $initStart) {
        $out.Add('    function initBuildGuideHandlers() {')
        $out.Add('        // Close modal when clicking outside content')
        $out.Add('        document.addEventListener(''click'', (e) => {')
        $out.Add('            if (e.target.id === ''build-guide-modal'') {')
        $out.Add('                closeBuildGuide();')
        $out.Add('            }')
        $out.Add('        });')
        $out.Add('')
        $out.Add('        // Close modal with Escape key')
        $out.Add('        document.addEventListener(''keydown'', (e) => {')
        $out.Add('            if (e.key === ''Escape'' && document.getElementById(''build-guide-modal'').classList.contains(''visible'')) {')
        $out.Add('                closeBuildGuide();')
        $out.Add('            }')
        $out.Add('        });')
        $out.Add('    }')
        $i = $listenerEnd
        continue
    }
    if ($i -gt $listenerEnd -and $i -lt $chunkEnd) {
        if ($lines[$i].StartsWith('        ')) {
            $out.Add($lines[$i].Substring(4))
        } else {
            $out.Add($lines[$i])
        }
        continue
    }
    if ($i -eq $chunkEnd -or $i -eq ($chunkEnd + 1)) { continue }
    $out.Add($lines[$i])
}

[IO.File]::WriteAllLines($p, $out, [Text.UTF8Encoding]::new($false))
Write-Host "Fixed build-guide.js: $($lines.Count) -> $($out.Count) lines"
