# Publishes the Windows .exe installer to a GitHub Release.
#
# The GitHub token is read from the GH_TOKEN environment variable, or from a
# local ".gh-token" file (which is gitignored and NEVER committed).
#
# Usage:
#   $env:GH_TOKEN = "ghp_yourtoken"   # or put the token in a file named .gh-token
#   ./publish.ps1

$ErrorActionPreference = "Stop"

# Prefer an env var; fall back to a local, gitignored token file.
if (-not $env:GH_TOKEN) {
    $tokenFile = Join-Path $PSScriptRoot ".gh-token"
    if (Test-Path $tokenFile) {
        $env:GH_TOKEN = (Get-Content $tokenFile -Raw).Trim()
    }
}

if (-not $env:GH_TOKEN) {
    Write-Error "No GitHub token found. Set `$env:GH_TOKEN or create a .gh-token file (see publish.ps1)."
    exit 1
}

Write-Host "Building and publishing to GitHub Releases..." -ForegroundColor Cyan
npm run publish
