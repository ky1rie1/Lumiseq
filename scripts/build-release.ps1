<#
.SYNOPSIS
  影序 Studio — repeatable Windows release build.

.DESCRIPTION
  1. Builds the web frontend (dist/) which Tauri embeds at compile time.
  2. Rebuilds the app crate so the freshly built frontend is really embedded.
  3. Builds the Rust release binary with the external Cargo target directory.
  4. Copies the executable to artifacts/windows/.
  5. Verifies the PE subsystem is 2 (Windows GUI, never a console window).
  6. Appends a build record to artifacts/windows/builds.json.

  The build runs through the Tauri CLI, never `cargo build --release` directly.
  tauri-build enables `dev` mode whenever the `custom-protocol` feature is off, and the Tauri
  CLI is what turns it on; a plain cargo release binary therefore still loads `devUrl`
  (http://localhost:5173) and is not a standalone application.

  Uses the current checkout and the external Cargo target configured by dev-env.ps1.
#>

[CmdletBinding()]
param(
    # Skip the forced app-crate rebuild. Faster, but it can leave a stale embedded frontend.
    [switch]$NoClean,
    # Copy the executable into artifacts/windows and record the build.
    [switch]$Publish,
    # A distinct name also lets a running older executable remain untouched.
    [string]$ArtifactName = 'lumiseq.exe'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path "$PSScriptRoot\..").Path
if ([System.IO.Path]::GetFileName($ArtifactName) -ne $ArtifactName -or [System.IO.Path]::GetExtension($ArtifactName) -ne '.exe') {
    throw 'ArtifactName must be a plain .exe filename.'
}

function Write-Step([string]$message) { Write-Host "==> $message" -ForegroundColor Cyan }

# --- 1. Environment -----------------------------------------------------------
. "$PSScriptRoot\dev-env.ps1" | Out-Null
$targetDir = $env:CARGO_TARGET_DIR
if (-not $targetDir) { throw 'CARGO_TARGET_DIR was not configured by dev-env.ps1.' }

# --- 2. Rust release build ----------------------------------------------------
$manifestPath = Join-Path $repoRoot 'src-tauri\Cargo.toml'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Cargo manifest is missing: $manifestPath" }

# generate_context! embeds dist/ at compile time, but Cargo does not treat dist/ as a
# source input. Dropping this package's artifacts guarantees the new UI is embedded.
if (-not $NoClean) {
    Write-Step 'Rebuilding the app crate so the current frontend is embedded'
    # Native stderr must not be redirected under ErrorActionPreference=Stop.
    & cargo clean --manifest-path $manifestPath -p lumiseq --release --target-dir $targetDir
    if ($LASTEXITCODE -ne 0) { throw "cargo clean failed with exit code $LASTEXITCODE" }
}

$tauriCli = Join-Path $repoRoot 'node_modules\.bin\tauri.cmd'
if (-not (Test-Path -LiteralPath $tauriCli)) { throw "The Tauri CLI is not installed: $tauriCli" }

# The CLI resolves `frontendDist` and runs `beforeBuildCommand` relative to tauri.conf.json.
# --no-bundle keeps this to the executable only; installers are a separate decision.
Write-Step 'Building the release binary through the Tauri CLI (custom-protocol + embedded frontend)'
Push-Location $repoRoot
try {
    & $tauriCli build --no-bundle
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }

$builtExe = Join-Path $targetDir 'release\lumiseq.exe'
if (-not (Test-Path -LiteralPath $builtExe)) { throw "Release binary was not produced: $builtExe" }

# --- 4. PE subsystem check ----------------------------------------------------
function Get-PeSubsystem([string]$path) {
    $stream = [System.IO.File]::OpenRead($path)
    try {
        $reader = New-Object System.IO.BinaryReader($stream)
        $stream.Position = 0x3C
        $peOffset = $reader.ReadInt32()
        $stream.Position = $peOffset
        $signature = $reader.ReadUInt32()
        if ($signature -ne 0x00004550) { throw "Not a PE file: $path" }
        # COFF header (20 bytes) then the optional header; Subsystem sits at +68.
        $stream.Position = $peOffset + 24 + 68
        return $reader.ReadUInt16()
    } finally { $stream.Dispose() }
}

$subsystem = Get-PeSubsystem $builtExe
Write-Step "PE subsystem = $subsystem (expected 2 = Windows GUI)"
if ($subsystem -ne 2) { throw "The release executable would open a console window (subsystem $subsystem)." }

$version = (Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$sizeBytes = (Get-Item -LiteralPath $builtExe).Length

# --- 5. Publish ---------------------------------------------------------------
if ($Publish) {
    $artifactDir = Join-Path $repoRoot 'artifacts\windows'
    if (-not (Test-Path -LiteralPath $artifactDir)) { New-Item -ItemType Directory -Path $artifactDir -Force | Out-Null }
    $artifactExe = Join-Path $artifactDir $ArtifactName
    Copy-Item -LiteralPath $builtExe -Destination $artifactExe -Force
    Write-Step "Published $artifactExe"

    $recordFile = Join-Path $artifactDir 'builds.json'
    # Existing records must survive: read and write explicitly as UTF-8 (Get-Content/Set-Content
    # fall back to the ANSI code page in Windows PowerShell), and flatten the parsed array with
    # foreach, because `@($raw | ConvertFrom-Json)` wraps the whole array as a single element and
    # would nest the history one level deeper on every build.
    $records = @()
    if (Test-Path -LiteralPath $recordFile) {
        $raw = [System.IO.File]::ReadAllText($recordFile)
        if ($raw.Trim()) {
            $parsed = ConvertFrom-Json -InputObject $raw
            foreach ($record in $parsed) { $records += $record }
        }
    }
    $records += [PSCustomObject]@{
        version    = $version
        sizeMB     = [math]::Round($sizeBytes / 1MB, 2)
        timestamp  = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        buildType  = 'release'
        phase      = '影序 Lumiseq：Windows 桌面发布版'
        subsystem  = $subsystem
        path       = "artifacts/windows/$ArtifactName"
        sizeBytes  = $sizeBytes
        sha256     = (Get-FileHash -LiteralPath $artifactExe -Algorithm SHA256).Hash.ToLowerInvariant()
        modelPackaging = 'embedded'
    }
    $json = ConvertTo-Json -InputObject $records -Depth 4
    [System.IO.File]::WriteAllText($recordFile, $json, (New-Object System.Text.UTF8Encoding($false)))
    Write-Step "Recorded build in $recordFile"
}

Write-Host ''
Write-Host 'Release build verified.' -ForegroundColor Green
[PSCustomObject]@{
    Executable = $builtExe
    Version    = $version
    SizeMB     = [math]::Round($sizeBytes / 1MB, 2)
    Subsystem  = $subsystem
    TargetDir  = $targetDir
} | Format-List

# An explicit exit code, so automation (and the shell that ran this script) can trust the result
# instead of inheriting whatever the last native command left in $LASTEXITCODE.
exit 0
