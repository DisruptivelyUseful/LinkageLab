# Ensures git, gh, and node are on PATH for Cursor agent shells and local terminals.
# Usage: . .\scripts\ensure-dev-env.ps1

$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = "$machinePath;$userPath"

$required = @(
    @{ Name = 'git';  Command = 'git' },
    @{ Name = 'gh';   Command = 'gh' },
    @{ Name = 'node'; Command = 'node' }
)

$missing = @()
foreach ($tool in $required) {
    if (-not (Get-Command $tool.Command -ErrorAction SilentlyContinue)) {
        $missing += $tool.Name
    }
}

if ($missing.Count -gt 0) {
    Write-Error "Missing dev tools: $($missing -join ', '). Install with: winget install Git.Git GitHub.cli OpenJS.NodeJS.LTS"
    exit 1
}

Write-Host "Dev environment OK: git $(git --version) | gh $(gh --version | Select-Object -First 1) | node $(node --version)"
