<#
.SYNOPSIS
  AI Creative Studio - Unified Development Environment Script
  Sets CARGO_TARGET_DIR dynamically to %LOCALAPPDATA%\AI-Creative-Studio\cargo-target
  so that Rust build artifacts never inflate the source repository and avoid MinGW windres space issues.
#>

$localAppData = $env:LOCALAPPDATA
if (-not $localAppData) {
    $localAppData = [System.IO.Path]::Combine($env:USERPROFILE, "AppData", "Local")
}

# Note: Uses hyphenated 'AI-Creative-Studio' to avoid GNU windres space parsing failure on Windows
$cargoTargetDir = [System.IO.Path]::Combine($localAppData, "AI-Creative-Studio", "cargo-target")

if (-not (Test-Path -LiteralPath $cargoTargetDir)) {
    New-Item -ItemType Directory -Path $cargoTargetDir -Force | Out-Null
    Write-Host "[dev-env] Created external Cargo cache directory: $cargoTargetDir" -ForegroundColor Cyan
}

# Cargo refuses to clean a target directory outside the workspace unless it is marked as a
# cache directory. The tag lets `cargo clean -p <pkg>` work for the externalized cache.
$cacheTag = Join-Path $cargoTargetDir 'CACHEDIR.TAG'
if (-not (Test-Path -LiteralPath $cacheTag)) {
    @(
        'Signature: 8a477f597d28d172789f06886806bc55'
        '# This file is a cache directory tag created by the Yingxu Studio development scripts.'
        '# For information about cache directory tags, see https://bford.info/cachedir/'
    ) | Set-Content -LiteralPath $cacheTag -Encoding ASCII
    Write-Host "[dev-env] Marked external Cargo cache with CACHEDIR.TAG" -ForegroundColor Cyan
}

$env:CARGO_TARGET_DIR = $cargoTargetDir
Write-Host "[dev-env] CARGO_TARGET_DIR set to: $env:CARGO_TARGET_DIR" -ForegroundColor Green

# Output current environment summary
[PSCustomObject]@{
    "CARGO_TARGET_DIR" = $env:CARGO_TARGET_DIR
    "LOCALAPPDATA"    = $localAppData
    "NODE_ENV"        = if ($env:NODE_ENV) { $env:NODE_ENV } else { "development" }
} | Format-List
