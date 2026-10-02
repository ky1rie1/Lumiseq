# Pinned SDK builds outside the repository. Only headers, notices and a static archive are distributed.
[CmdletBinding()]
param([int]$Jobs=4)
$ErrorActionPreference='Stop'
$revision='446c736a38fb14f51343605c0780d347dc602f89'
$dependencyRoot=Join-Path $env:LOCALAPPDATA 'AI-Creative-Studio/native-deps'
$source=Join-Path $dependencyRoot 'gpr'
$build=Join-Path $dependencyRoot 'gpr-build'
$destination=[IO.Path]::GetFullPath("$PSScriptRoot/../src-tauri/native/gpr")
New-Item -ItemType Directory -Path $dependencyRoot -Force | Out-Null
if(!(Test-Path -LiteralPath (Join-Path $source '.git'))){
  & git clone https://github.com/gopro/gpr.git $source
  if($LASTEXITCODE -ne 0){throw 'GPR source download failed'}
}
& git -C $source checkout --detach $revision
if($LASTEXITCODE -ne 0){throw 'Pinned GPR source checkout failed'}
# Old Adobe Windows pthread emulation conflicts with modern MinGW. SDK processing
# is serial; the Lumiseq wrapper protects all SDK calls with a mutex.
& cmake -S $source -B $build -G 'MinGW Makefiles' '-DCMAKE_BUILD_TYPE=Release' '-DCMAKE_CXX_FLAGS_RELEASE=-O3 -DNDEBUG -DqDNGThreadSafe=0 -DGPR_TIMING=0 -w'
if($LASTEXITCODE -ne 0){throw 'GPR configure failed'}
& cmake --build $build --parallel $Jobs --target gpr_tools
if($LASTEXITCODE -ne 0){throw 'GPR build failed'}
Push-Location $build
try {
  # MRI preserves duplicate object names across VC5 libraries.
  $libraries=Get-ChildItem source/lib -Recurse -Filter '*.a' | Sort-Object FullName
  $buildPath=(Resolve-Path $build).Path.TrimEnd('\','/')
  $mri=@('CREATE libgpr.a')+@($libraries | ForEach-Object {'ADDLIB '+$_.FullName.Substring($buildPath.Length+1).Replace('\','/')})+@('SAVE','END')
  ($mri -join "`n") | & ar -M
  if($LASTEXITCODE -ne 0){throw 'Combined GPR archive failed'}
} finally {Pop-Location}
New-Item -ItemType Directory -Path (Join-Path $destination 'include'),(Join-Path $destination 'lib') -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $source 'source/lib/common/public'),(Join-Path $source 'source/lib/gpr_sdk/public') -Filter '*.h' | ForEach-Object {Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $destination 'include')}
Copy-Item -LiteralPath (Join-Path $build 'libgpr.a') -Destination (Join-Path $destination 'lib/libgpr.a')
