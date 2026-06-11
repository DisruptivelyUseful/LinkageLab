# Extract GLTF export + scene render pipeline from index.html (Phase 3e/3f)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$indexPath = Join-Path $root 'index.html'
$lines = [System.IO.File]::ReadAllLines($indexPath)

# 1-based line numbers from grep
$gltfStart = 2425   # blank line before GLTF section
$gltfEnd = 3738     # end of executeGLTFExport
$sceneStart = 3739  # blank before updateThreeJSScenes comment
$sceneEnd = 4169    # end of renderThreeJS

$gltfChunk = $lines[($gltfStart - 1)..($gltfEnd - 1)]
$sceneChunk = $lines[($sceneStart - 1)..($sceneEnd - 1)]

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
        "// ============================================================================",
        ('// LINKAGE LAB - ' + $Title),
        "// $Depends",
        "// ============================================================================",
        "(function (g) {",
        "    'use strict';",
        ""
    )
    $footer = @(
        "",
        "    g.LinkageModules = g.LinkageModules || {};",
        "    g.LinkageModules.$ModuleKey = { };",
        ""
    )
    foreach ($exp in $Exports) {
        $footer += "    g.$exp = $exp;"
    }
    $footer += @(
        "",
        "})(window);",
        ""
    )
    $all = $header + ($Chunk | ForEach-Object { "    $_" }) + $footer
    [System.IO.File]::WriteAllLines($Path, $all, [System.Text.UTF8Encoding]::new($false))
    Write-Host "Wrote $($all.Count) lines to $Path"
}

$gltfPath = Join-Path $root 'js\linkage\gltf-export.js'
$scenePath = Join-Path $root 'js\linkage\scene-render.js'

Write-LinkageModule -Path $gltfPath -Title 'GLTF export' -ModuleKey 'gltfExport' -Depends 'Depends on global: THREE, state, showToast, ibcGlbState, buildLinkageGeometry, getLinkageData' `
    -Chunk $gltfChunk -Exports @(
    'exportToGLTF', 'showGLTFExportDialog', 'closeGLTFExportModal', 'executeGLTFExport'
)

Write-LinkageModule -Path $scenePath -Title 'Scene render pipeline' -ModuleKey 'sceneRender' -Depends 'Depends on global: THREE, threeRenderer, state, clearGroup, createBeamMesh, initThreeJS, updateHumanScaleFigure, updateIbcGlbReference' `
    -Chunk $sceneChunk -Exports @(
    'updateThreeJSScenes', 'renderActuatorLine', 'updateOrthoScenes', 'renderThreeJS'
)

# Strip from index.html
$tempPath = "$indexPath.tmp"
$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($ln -ge $gltfStart -and $ln -le $gltfEnd) {
        if ($ln -eq $gltfStart) {
            $out.Add('// GLTF export — js/linkage/gltf-export.js')
            $out.Add('')
        }
        continue
    }
    if ($ln -ge $sceneStart -and $ln -le $sceneEnd) {
        if ($ln -eq $sceneStart) {
            $out.Add('// Scene render pipeline — js/linkage/scene-render.js')
            $out.Add('')
        }
        continue
    }
    $out.Add($lines[$i])
}
[System.IO.File]::WriteAllLines($tempPath, $out, [System.Text.UTF8Encoding]::new($false))
Move-Item -Path $tempPath -Destination $indexPath -Force
Write-Host "Stripped index.html: $($lines.Count) -> $($out.Count) lines"
