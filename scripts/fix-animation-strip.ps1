$p = Join-Path (Split-Path $PSScriptRoot -Parent) 'index.html'
$lines = [IO.File]::ReadAllLines($p)
$out = [System.Collections.Generic.List[string]]::new()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $ln = $i + 1
    if ($ln -ge 5962 -and $ln -le 6208) {
        if ($ln -eq 5962) {
            $out.Add('// Animation system - js/linkage/animation.js')
            $out.Add('')
        }
        continue
    }
    $out.Add($lines[$i])
}
[IO.File]::WriteAllLines($p, $out, [Text.UTF8Encoding]::new($false))
Write-Host "Fixed animation strip: $($out.Count) lines"
