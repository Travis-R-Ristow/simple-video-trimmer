# Cuts a new release: bumps the version, creates the git tag, and pushes it.
#
# Pushing the v* tag triggers the GitHub Actions workflow that builds and
# publishes the installer to a GitHub Release (.github/workflows/release.yml).
# The in-app updater then offers that release to users automatically.
#
# Usage:
#   ./release.ps1            # patch bump (1.0.0 -> 1.0.1)
#   ./release.ps1 minor      # feature release (1.0.0 -> 1.1.0)
#   ./release.ps1 major      # breaking release (1.0.0 -> 2.0.0)

param(
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump = 'patch'
)

$ErrorActionPreference = 'Stop'

# Refuse to release with uncommitted changes so the tag matches what's built.
$dirty = git status --porcelain
if ($dirty) {
    Write-Error "Working tree is not clean. Commit or stash your changes first."
    exit 1
}

Write-Host "Bumping $Bump version..." -ForegroundColor Cyan
$newVersion = npm version $Bump
Write-Host "New version: $newVersion" -ForegroundColor Green

Write-Host "Pushing commit and tag to GitHub..." -ForegroundColor Cyan
git push --follow-tags

Write-Host ""
Write-Host "Done. GitHub Actions is building and publishing the release." -ForegroundColor Green
Write-Host "Track progress: https://github.com/Travis-R-Ristow/simple-video-trimmer/actions" -ForegroundColor Green
