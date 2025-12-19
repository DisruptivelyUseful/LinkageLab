@echo off
echo ========================================
echo   LinkageLab Local Server
echo ========================================
echo.
echo Starting server on http://localhost:8000
echo.
echo Press Ctrl+C to stop the server
echo.
echo Your browser should open automatically...
echo If not, open: http://localhost:8000/index.html
echo.
echo ========================================
timeout /t 2 >nul
start http://localhost:8000/index.html
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"$listener = New-Object System.Net.HttpListener; ^
$listener.Prefixes.Add('http://localhost:8000/'); ^
$listener.Start(); ^
Write-Host 'Server running on http://localhost:8000'; ^
Write-Host 'Press Ctrl+C to stop...'; ^
while ($listener.IsListening) { ^
    $context = $listener.GetContext(); ^
    $request = $context.Request; ^
    $response = $context.Response; ^
    $path = $request.Url.LocalPath; ^
    if ($path -eq '/') { $path = '/index.html' }; ^
    $filePath = Join-Path (Get-Location) $path.TrimStart('/'); ^
    if (Test-Path $filePath -PathType Leaf) { ^
        $content = [System.IO.File]::ReadAllBytes($filePath); ^
        $ext = [System.IO.Path]::GetExtension($filePath).ToLower(); ^
        $mimeTypes = @{ ^
            '.html' = 'text/html'; ^
            '.css' = 'text/css'; ^
            '.js' = 'application/javascript'; ^
            '.json' = 'application/json'; ^
            '.png' = 'image/png'; ^
            '.jpg' = 'image/jpeg'; ^
            '.gif' = 'image/gif'; ^
            '.svg' = 'image/svg+xml' ^
        }; ^
        $response.ContentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }; ^
        $response.ContentLength64 = $content.Length; ^
        $response.OutputStream.Write($content, 0, $content.Length); ^
    } else { ^
        $response.StatusCode = 404; ^
        $buffer = [System.Text.Encoding]::UTF8.GetBytes('404 - File Not Found'); ^
        $response.OutputStream.Write($buffer, 0, $buffer.Length); ^
    }; ^
    $response.Close(); ^
}"
