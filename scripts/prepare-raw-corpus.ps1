<#
.SYNOPSIS
  Prepare SHA-256 verified CC0 camera samples outside the repository.
.DESCRIPTION
  Metadata is versioned; photos, local manifests and generated reports are not.
  Unsupported samples are opt-in and deliberately fail the native compatibility gate.
#>
[CmdletBinding()]
param(
    [string]$Directory = (Join-Path $env:LOCALAPPDATA 'AI-Creative-Studio\raw-validation-samples'),
    [switch]$IncludeUnsupported,
    [switch]$ExistingOnly,
    [ValidateRange(1, 72)][int]$Limit = 72,
    [ValidateRange(1, 2048)][int]$MaxTotalMiB = 2048,
    [string]$Proxy
)
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$root = [IO.Path]::GetFullPath($Directory)
if ($root.TrimEnd('\','/') -eq $repoRoot -or $root.StartsWith($repoRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Camera samples must be stored outside the source checkout.'
}
$samples = Get-Content -LiteralPath (Join-Path $repoRoot 'tests\raw-fixtures\camera-corpus.json') -Raw | ConvertFrom-Json
$selected = @($samples | Where-Object { $_.license -eq 'CC0-1.0' -and ($IncludeUnsupported -or $_.expected -eq 'supported') } | Select-Object -First $Limit)
New-Item -ItemType Directory -Path $root -Force | Out-Null
$manifest = @(); $totalBytes = [long]0
foreach ($sample in $selected) {
    if ($sample.file -ne [IO.Path]::GetFileName($sample.file) -or $sample.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid fixture metadata.' }
    $url = [uri]$sample.url
    if ($url.Scheme -ne 'https' -or $url.Host -ne 'raw.pixls.us') { throw 'Unexpected sample source.' }
    $path = Join-Path $root $sample.file
    if (-not (Test-Path -LiteralPath $path)) {
        if ($ExistingOnly) { continue }
        $partial = $path + '.part'
        if (Test-Path -LiteralPath $partial) { throw "Partial download already exists: $partial. Inspect it before retrying." }
        $curlArgs = @('--fail','--location','--retry','2','--max-time','240','--max-filesize','536870912','--output',$partial)
        if ($Proxy) { $curlArgs += @('--proxy',$Proxy) }
        & curl.exe @curlArgs $sample.url
        if ($LASTEXITCODE -ne 0) { throw "Download failed: $($sample.file); partial file retained outside the repository." }
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sample.sha256) { throw "Sample hash mismatch: $partial" }
        $candidateBytes = (Get-Item -LiteralPath $partial).Length
        if ($totalBytes + $candidateBytes -gt ([long]$MaxTotalMiB * 1MB)) { throw 'Corpus size budget exceeded; downloaded file retained for inspection.' }
        Move-Item -LiteralPath $partial -Destination $path
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sample.sha256) { throw "Existing sample hash mismatch: $path" }
    $totalBytes += (Get-Item -LiteralPath $path).Length
    if ($totalBytes -gt ([long]$MaxTotalMiB * 1MB)) { throw 'Corpus size budget exceeded.' }
    $manifest += [ordered]@{path=$path; brand=$sample.brand; model=$sample.model; extension=$sample.extension}
    Write-Host "$($sample.brand) $($sample.model) .$($sample.extension): verified"
}
if (-not $manifest.Count) { throw 'No verified samples available.' }
$manifestPath = Join-Path $root 'lumiseq-corpus.local.json'
ConvertTo-Json -InputObject $manifest -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "$($manifest.Count) samples; $([math]::Round($totalBytes/1MB,1)) MiB; manifest: $manifestPath"
