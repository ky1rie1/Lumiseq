# Rebuild the vendored decoder with Foveon enabled. No Unix rm/shell is needed.
[CmdletBinding()]
param([int]$Jobs=4)
$ErrorActionPreference='Stop'
$decoderRoot=(Resolve-Path "$PSScriptRoot/../src-tauri/native/libraw").Path
New-Item -ItemType Directory -Path (Join-Path $decoderRoot 'object') -Force | Out-Null
Push-Location $decoderRoot
try {
  # Compile only object targets: the upstream archive recipe requires Unix rm.
  $makefile=Get-Content -LiteralPath 'Makefile.mingw' -Raw
  $match=[regex]::Match($makefile,'(?s)LIB_OBJECTS=(.*?)\r?\n\r?\n')
  if(!$match.Success){throw 'LibRaw object list was not found'}
  $objects=($match.Groups[1].Value -replace '\\\r?\n',' ' -split '\s+') | Where-Object {$_}
  & mingw32-make -B "-j$Jobs" -f Makefile.mingw 'CFLAGS=-O3 -I. -w -DUSE_X3FTOOLS' @objects
  if($LASTEXITCODE -ne 0){throw 'LibRaw object compilation failed'}
  & ar crs lib/libraw.a @objects
  if($LASTEXITCODE -ne 0){throw 'LibRaw archive failed'}
} finally {Pop-Location}
