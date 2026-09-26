@echo off
setlocal EnableExtensions
REM ============================================================
REM   LinkageLab - pull the working branch and start the server
REM
REM   Double-click this file from your repo folder. It will:
REM     1. fetch and fast-forward the branch named below
REM     2. install dependencies the first time only
REM     3. open http://localhost:8000 and serve the app
REM
REM   Branch: first argument, else the .dev-branch file, else main.
REM   Press Ctrl+C in this window to stop the server.
REM ============================================================
cd /d "%~dp0"

set "BRANCH=%~1"
if "%BRANCH%"=="" if exist ".dev-branch" set /p BRANCH=<.dev-branch
if "%BRANCH%"=="" set "BRANCH=main"
set "PORT=8000"

echo ========================================
echo   LinkageLab dev launcher
echo   Branch: %BRANCH%
echo   Folder: %CD%
echo ========================================
echo.

where git >nul 2>&1 || (
    echo [!] git was not found on your PATH.
    echo     Install Git for Windows: https://git-scm.com/download/win
    echo     ^(GitHub Desktop ships its own git; opening a "Command Prompt" from
    echo     its Repository menu also puts git on PATH.^)
    goto :fail
)
where node >nul 2>&1 || (
    echo [!] node was not found on your PATH.
    echo     Install Node.js LTS: https://nodejs.org/
    goto :fail
)

REM --- never discard local edits ---------------------------------
git diff --quiet && git diff --cached --quiet
if errorlevel 1 (
    echo [!] You have uncommitted changes in this folder.
    echo     Commit or discard them in GitHub Desktop, then run this again.
    git status --short
    goto :fail
)

echo [1/3] Fetching origin/%BRANCH% ...
git fetch origin "%BRANCH%"
if errorlevel 1 (
    echo [!] Could not fetch "%BRANCH%" from origin. Check the branch name in .dev-branch
    echo     and your internet connection.
    goto :fail
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "CURRENT=%%b"
if /i not "%CURRENT%"=="%BRANCH%" (
    echo       Switching from %CURRENT% to %BRANCH% ...
    git show-ref --verify --quiet "refs/heads/%BRANCH%"
    if errorlevel 1 (
        git checkout -b "%BRANCH%" --track "origin/%BRANCH%" || goto :fail
    ) else (
        git checkout "%BRANCH%" || goto :fail
    )
)

git pull --ff-only origin "%BRANCH%"
if errorlevel 1 (
    echo [!] The branch could not be fast-forwarded. Your local copy has commits
    echo     that are not on origin; resolve this in GitHub Desktop, then retry.
    goto :fail
)
echo       Now at:
git log -1 --pretty=format:"       %%h  %%s  (%%cr)"
echo.
echo.

REM --- dependencies (only needed for tests; skip if already there) --
if not exist "node_modules\" (
    echo [2/3] First run: installing dependencies ^(npm ci^) ...
    call npm ci --no-audit --no-fund
    if errorlevel 1 echo       npm ci failed; the app itself needs no dependencies, continuing.
) else (
    echo [2/3] Dependencies present.
)
echo.

REM --- is something already serving on the port? -------------------
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo [3/3] Something is already listening on port %PORT% - reusing it.
    echo       If that is an OLD server, close its window and run this again.
    start "" "http://localhost:%PORT%/index.html"
    echo.
    echo       Remember to hard-refresh the page ^(Ctrl+Shift+R^) after each update.
    pause
    exit /b 0
)

echo [3/3] Starting server on http://localhost:%PORT%
echo       Hard-refresh the page ^(Ctrl+Shift+R^) after each update.
echo       Press Ctrl+C to stop.
echo.
start "" /min cmd /c "timeout /t 2 >nul && start http://localhost:%PORT%/index.html"
node scripts\static-server.mjs --port %PORT%
goto :eof

:fail
echo.
pause
exit /b 1
