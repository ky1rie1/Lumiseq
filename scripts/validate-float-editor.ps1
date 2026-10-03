[CmdletBinding()]
param(
    [string]$RawPath,
    [string]$ReportDirectory = (Join-Path $env:LOCALAPPDATA 'AI-Creative-Studio/float-editor-validation'),
    [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reportRoot = [IO.Path]::GetFullPath($ReportDirectory)
$repoPrefix = $repoRoot.TrimEnd('\') + '\'
if ($reportRoot -eq $repoRoot -or $reportRoot.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Keep acceptance reports outside the source repository.'
}
if ($RawPath) { $RawPath = (Resolve-Path -LiteralPath $RawPath).Path }
try {
    $page = Invoke-WebRequest 'http://127.0.0.1:5173/integration/float-editor-validation.html' -UseBasicParsing -TimeoutSec 5
    if ($page.StatusCode -ne 200) { throw 'The acceptance page is unavailable.' }
} catch { throw 'Start npm run dev -- --host 127.0.0.1 on port 5173 before running this opt-in check.' }

. (Join-Path $PSScriptRoot 'dev-env.ps1') | Out-Null
if (-not $SkipBuild) {
    & cargo build --release --manifest-path (Join-Path $repoRoot 'src-tauri/Cargo.toml') --features quality-probe --bin spatial-quality-probe
    if ($LASTEXITCODE -ne 0) { throw 'Quality probe build failed.' }
}
$probe = Join-Path $env:CARGO_TARGET_DIR 'release/spatial-quality-probe.exe'
if (-not (Test-Path -LiteralPath $probe)) { throw 'The native quality probe is missing.' }
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
$reportPath = Join-Path $reportRoot 'webview-report.json'
$previous = @{}
foreach ($name in @('LUMISEQ_GPU_CASE', 'LUMISEQ_GPU_REPORT', 'LUMISEQ_PROBE_RAW')) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$started = [DateTime]::UtcNow
try {
    $env:LUMISEQ_GPU_CASE = 'edit-float'
    $env:LUMISEQ_GPU_REPORT = $reportPath
    [Environment]::SetEnvironmentVariable('LUMISEQ_PROBE_RAW', $RawPath, 'Process')
    $process = Start-Process -FilePath $probe -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
    if (-not $process.WaitForExit(420000)) {
        Stop-Process -Id $process.Id
        throw 'Native WebView acceptance timed out.'
    }
    $file = Get-Item -LiteralPath $reportPath
    if ($file.LastWriteTimeUtc -lt $started) { throw 'The probe did not write a fresh report.' }
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    $failures = @($report.cases | Where-Object { -not $_.passed })
    if (-not $report.complete -or -not $report.passed -or $failures.Count -or $report.errors.Count) {
        $report | ConvertTo-Json -Depth 20 | Write-Output
        throw 'Native WebView acceptance failed; inspect the external report.'
    }
    $skipped = @($report.cases | Where-Object { $_.details.skipped }).Count
    Write-Output "Passed $($report.cases.Count - $skipped) cases; skipped $skipped. Report: $reportPath"
} finally {
    foreach ($name in $previous.Keys) { [Environment]::SetEnvironmentVariable($name, $previous[$name], 'Process') }
}
