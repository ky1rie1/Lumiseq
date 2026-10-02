<# Creates a portable ZIP from an explicit public-file allowlist, never the output directory. #>
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Directory, [Parameter(Mandatory=$true)][string]$Version)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$') { throw 'Invalid release version.' }
$releaseDirectory = (Resolve-Path -LiteralPath $Directory).Path
$names = @('lumiseq.exe', 'WebView2Loader.dll', 'LICENSE', 'THIRD_PARTY_NOTICES.txt', 'README.txt', 'SHA256SUMS.txt')
$files = @($names | ForEach-Object {
    $file = Join-Path $releaseDirectory $_
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required portable file is missing: $_" }
    $file
})
$archive = Join-Path $releaseDirectory "Lumiseq-$Version-windows-x64.zip"
Compress-Archive -LiteralPath $files -DestinationPath $archive -CompressionLevel Optimal -Force
Write-Host "Portable package created: $archive"
