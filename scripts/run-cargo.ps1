<#
.SYNOPSIS
  AI Creative Studio - Helper script to run Cargo commands with external CARGO_TARGET_DIR
#>

# 1. Source dev-env
. "$PSScriptRoot\dev-env.ps1"

# 2. Resolve this checkout instead of relying on a developer-specific junction.
$manifestDir = (Resolve-Path "$PSScriptRoot\..\src-tauri").Path

Write-Host "[run-cargo] Working Directory: $manifestDir" -ForegroundColor Cyan
Write-Host "[run-cargo] Executing: cargo $($args -join ' ')" -ForegroundColor Cyan

Push-Location $manifestDir
try {
    & cargo @args
    $exitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

exit $exitCode
