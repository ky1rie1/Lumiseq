[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$Dependencies,
    [switch]$Models,
    [switch]$ReleaseArtifacts
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Remove-ProjectPath([string]$RelativePath) {
    $target = [System.IO.Path]::GetFullPath((Join-Path $projectRoot $RelativePath))
    $prefix = $projectRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $target.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove a path outside the project: $target"
    }
    if (-not (Test-Path -LiteralPath $target)) { return }
    $ancestor = Get-Item -LiteralPath $target -Force
    while ($ancestor -and $ancestor.FullName.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        if (($ancestor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Refusing to clean through a junction or symbolic link: $($ancestor.FullName)"
        }
        $ancestor = if ($ancestor.PSIsContainer) { $ancestor.Parent } else { $ancestor.Directory }
    }
    if ($PSCmdlet.ShouldProcess($target, 'Remove generated workspace output')) {
        Write-Host "Removing $RelativePath" -ForegroundColor DarkGray
        Remove-Item -LiteralPath $target -Recurse -Force
    }
}

$targets = @(
    'dist',
    'coverage',
    'generated-test-output',
    'artifacts\verification',
    'src-tauri\target',
    'src-tauri\gen\schemas',
    'tsconfig.tsbuildinfo'
)

if ($ReleaseArtifacts) { $targets += 'artifacts\windows' }
if ($Dependencies) { $targets += 'node_modules' }

foreach ($target in $targets) { Remove-ProjectPath $target }

if ($Models) {
    Get-ChildItem -LiteralPath (Join-Path $projectRoot 'resources\cutout') -Filter '*.onnx' -File -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-ProjectPath $_.FullName.Substring($projectRoot.Length + 1) }
}

Write-Host 'Lumiseq workspace cleanup complete.' -ForegroundColor Green
