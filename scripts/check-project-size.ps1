<#
.SYNOPSIS
  AI Creative Studio - Project Size Budget & Audit Script
  Inspects physical project directories, detects Junctions/ReparsePoints to avoid double counting,
  measures categories (Source, node_modules, LibRaw, Artifacts, External Cargo Cache, Runtime Cache),
  and warns against budget exceedances.
#>

param(
    [string]$ProjectRoot = "$PSScriptRoot\.."
)

$resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

# Check if current path is a Junction / ReparsePoint
$item = Get-Item -LiteralPath $resolvedRoot -Force
$isReparse = ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq [System.IO.FileAttributes]::ReparsePoint

Write-Host "======================================================" -ForegroundColor Cyan
Write-Host " AI Creative Studio - Project Size Budget Audit" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "Logical Path:  $resolvedRoot"
Write-Host "Is Junction:   $isReparse"
if ($isReparse) {
    Write-Host "Target:        $($item.Target)"
}
Write-Host "------------------------------------------------------"

function Get-DirSizeMB([string]$path) {
    if (-not (Test-Path -LiteralPath $path)) { return 0 }
    $files = Get-ChildItem -LiteralPath $path -Recurse -File -Force -ErrorAction SilentlyContinue
    if (-not $files) { return 0 }
    $sum = ($files | Measure-Object -Property Length -Sum).Sum
    return [math]::Round($sum / 1MB, 2)
}

# Measure categories
$nodeModulesSize = Get-DirSizeMB (Join-Path $resolvedRoot "node_modules")
$artifactsSize   = Get-DirSizeMB (Join-Path $resolvedRoot "artifacts")
$distSize        = Get-DirSizeMB (Join-Path $resolvedRoot "dist")
$resourcesSize   = Get-DirSizeMB (Join-Path $resolvedRoot "resources")
$librawSize      = Get-DirSizeMB (Join-Path $resolvedRoot "src-tauri\native\libraw")
$tauriTargetSize = Get-DirSizeMB (Join-Path $resolvedRoot "src-tauri\target")

# External caches in %LOCALAPPDATA%
$localAppData = $env:LOCALAPPDATA
if (-not $localAppData) { $localAppData = Join-Path $env:USERPROFILE "AppData\Local" }
$appDataStudio = Join-Path $localAppData "AI-Creative-Studio"
$cargoTargetDir = Join-Path $appDataStudio "cargo-target"
$cargoCacheSize = Get-DirSizeMB $cargoTargetDir
$modelsCacheSize = Get-DirSizeMB (Join-Path $appDataStudio "models")
$runtimeCacheSize = Get-DirSizeMB (Join-Path $appDataStudio "runtime-cache")
$referenceSourceSize = Get-DirSizeMB (Join-Path $appDataStudio "reference-source")

# Calculate pure source size (excluding dependencies and generated build output)
$allFiles = Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\artifacts\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\src-tauri\\target\\' -and
    $_.FullName -notmatch '\\\.git\\' -and
    $_.FullName -notmatch '\\reference-source\\'
}
$sourceTotalBytes = ($allFiles | Measure-Object -Property Length -Sum).Sum
$sourceSizeMB = [math]::Round($sourceTotalBytes / 1MB, 2)
$pureSourceSizeMB = [math]::Round(($sourceSizeMB - $librawSize - $resourcesSize), 2)

# Total physical size on disk for this repo
$repoFiles = Get-ChildItem -LiteralPath $resolvedRoot -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object {
    $_.FullName -notmatch '\\\.git\\'
}
$repoTotalBytes = ($repoFiles | Measure-Object -Property Length -Sum).Sum
$repoTotalMB = [math]::Round($repoTotalBytes / 1MB, 2)

# Display report
$report = @(
    [PSCustomObject]@{ Category = "Pure Source Code (src, tests, configs)"; SizeMB = $pureSourceSizeMB; BudgetMB = "300 MB"; Status = if ($pureSourceSizeMB -lt 300) { "OK" } else { "WARNING" } }
    [PSCustomObject]@{ Category = "Bundled Resources (resources)"; SizeMB = $resourcesSize; BudgetMB = "N/A (Runtime)"; Status = "INFO" }
    [PSCustomObject]@{ Category = "LibRaw Source & Headers"; SizeMB = $librawSize; BudgetMB = "100 MB"; Status = if ($librawSize -lt 100) { "OK" } else { "WARNING" } }
    [PSCustomObject]@{ Category = "Dependencies (node_modules)"; SizeMB = $nodeModulesSize; BudgetMB = "N/A (Dev)"; Status = "INFO" }
    [PSCustomObject]@{ Category = "Generated Web Build (dist)"; SizeMB = $distSize; BudgetMB = "N/A (Build)"; Status = "INFO" }
    [PSCustomObject]@{ Category = "Artifacts (Release Binaries)"; SizeMB = $artifactsSize; BudgetMB = "500 MB"; Status = if ($artifactsSize -lt 500) { "OK" } else { "WARNING" } }
    [PSCustomObject]@{ Category = "Internal Rust Target (src-tauri/target)"; SizeMB = $tauriTargetSize; BudgetMB = "0 MB (Moved)"; Status = if ($tauriTargetSize -eq 0) { "OK" } else { "NEEDS CLEANUP" } }
    [PSCustomObject]@{ Category = "External Cargo Cache (%LOCALAPPDATA%)"; SizeMB = $cargoCacheSize; BudgetMB = "External"; Status = "EXTERNAL" }
    [PSCustomObject]@{ Category = "Optional Local Models (%LOCALAPPDATA%)"; SizeMB = $modelsCacheSize; BudgetMB = "External"; Status = "OPTIONAL" }
    [PSCustomObject]@{ Category = "Runtime App Cache (%LOCALAPPDATA%)"; SizeMB = $runtimeCacheSize; BudgetMB = "External"; Status = "EXTERNAL" }
    [PSCustomObject]@{ Category = "Reference Source (%LOCALAPPDATA%)"; SizeMB = $referenceSourceSize; BudgetMB = "External"; Status = "EXTERNAL" }
)

$report | Format-Table -AutoSize

Write-Host "Total Repository Size (excluding .git): $repoTotalMB MB" -ForegroundColor Yellow

# Check single large unexpected files > 100MB
$knownModelPath = Join-Path $resolvedRoot 'resources\cutout\birefnet-lite-512.onnx'
$largeFiles = $allFiles | Where-Object { $_.Length -gt 100MB -and $_.FullName -ne $knownModelPath }
if ($largeFiles) {
    Write-Host "`n[WARNING] Found files exceeding 100 MB in repository:" -ForegroundColor Red
    foreach ($f in $largeFiles) {
        Write-Host "  - $($f.FullName) ($([math]::Round($f.Length / 1MB, 2)) MB)" -ForegroundColor Red
    }
} else {
    Write-Host "`n[OK] No unexpected single files exceeding 100 MB found in repository." -ForegroundColor Green
}
if (Test-Path -LiteralPath $knownModelPath) {
    Write-Host "[INFO] Expected bundled cutout model: $([math]::Round((Get-Item -LiteralPath $knownModelPath).Length / 1MB, 2)) MB" -ForegroundColor Gray
}
