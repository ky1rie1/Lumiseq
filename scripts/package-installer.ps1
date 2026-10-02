<# Bundle the verified release with Tauri's WebView2 provisioning and refresh package checksums. #>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
. "$PSScriptRoot\dev-env.ps1" | Out-Null
$version = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$productName = (Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri\tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json).productName
$releaseDirectory = Join-Path $repoRoot 'artifacts\windows'
$nativeDirectory = Join-Path $env:CARGO_TARGET_DIR 'release'
& node (Join-Path $PSScriptRoot 'windows-release.mjs') verify $releaseDirectory
if ($LASTEXITCODE -ne 0) { throw 'Prepare the complete release before creating the installer.' }
foreach ($name in @('lumiseq.exe', 'WebView2Loader.dll')) {
    $built = Join-Path $nativeDirectory $name
    $staged = Join-Path $releaseDirectory $name
    if ((Get-FileHash -LiteralPath $built -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $staged -Algorithm SHA256).Hash) {
        throw "Staged $name differs from the Tauri build; rebuild and prepare the release first."
    }
}
foreach ($name in @('LICENSE', 'THIRD_PARTY_NOTICES.txt', 'README.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $releaseDirectory $name) -PathType Leaf)) { throw "Run npm run release:prepare first: $name is missing." }
}
$binaryVersion = (Get-Item -LiteralPath (Join-Path $nativeDirectory 'lumiseq.exe')).VersionInfo.FileVersion
if ($binaryVersion -ne $version -and $binaryVersion -ne "$version.0") { throw 'The native executable version does not match the package version.' }
$cli = Join-Path $repoRoot 'node_modules\.bin\tauri.cmd'
Push-Location $repoRoot
try {
    & $cli bundle --config src-tauri/tauri.release.conf.json --bundles nsis --ci
    if ($LASTEXITCODE -ne 0) { throw "Tauri installer bundling failed with exit code $LASTEXITCODE." }
} finally {
    Pop-Location
    # The CLI stamps its NSIS bundle type into the native EXE. Restore the verified
    # portable input after bundling so repeating this command starts from the same input.
    Copy-Item -LiteralPath (Join-Path $releaseDirectory 'lumiseq.exe') -Destination (Join-Path $nativeDirectory 'lumiseq.exe') -Force
}
$builtInstaller = Join-Path $nativeDirectory "bundle\nsis\${productName}_${version}_x64-setup.exe"
if (-not (Test-Path -LiteralPath $builtInstaller -PathType Leaf)) { throw "Installer missing: $builtInstaller" }
$installerVersion = (Get-Item -LiteralPath $builtInstaller).VersionInfo.FileVersion
if ($installerVersion -ne $version -and $installerVersion -ne "$version.0") { throw "Installer version $installerVersion does not match $version." }
$outputInstaller = Join-Path $releaseDirectory "Lumiseq-$version-windows-x64-setup.exe"
Copy-Item -LiteralPath $builtInstaller -Destination $outputInstaller -Force
Push-Location $repoRoot
try {
    & node (Join-Path $PSScriptRoot 'prepare-release.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Final package checksum preparation failed.' }
} finally { Pop-Location }
Write-Host "Windows installer prepared: $outputInstaller"
exit 0
