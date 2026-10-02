param(
  [ValidateSet('Run','Probe')][string]$Mode='Run',
  [ValidatePattern('^v\d+\.\d+\.\d+$')][string]$ReleaseTag='v0.9.7',
  [string]$PackageDirectory
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($Mode -eq 'Run' -and ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or -not $IsWindows)) {
  throw 'Only a disposable GitHub-hosted Windows runner may perform Runtime-free acceptance.'
}

# Read-only Loader probe. Load the exact package DLL, not a PATH fallback.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LumiseqRuntimeProbe {
  [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
  [DllImport("kernel32", CharSet=CharSet.Ansi)]
  static extern IntPtr GetProcAddress(IntPtr module, string name);
  [DllImport("kernel32")] static extern bool FreeLibrary(IntPtr module);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)]
  delegate int GetVersion(IntPtr folder, out IntPtr version);
  public static string[] Read(string loader) {
    IntPtr module=LoadLibraryEx(loader, IntPtr.Zero, 0x00000900);
    if(module==IntPtr.Zero) throw new InvalidOperationException("Package Loader cannot be loaded: "+Marshal.GetLastWin32Error());
    try {
      IntPtr entry=GetProcAddress(module,"GetAvailableCoreWebView2BrowserVersionString");
      if(entry==IntPtr.Zero) throw new InvalidOperationException("Loader version API missing");
      var get=Marshal.GetDelegateForFunctionPointer<GetVersion>(entry);
      IntPtr version;
      int hr=get(IntPtr.Zero,out version);
      try { return new[]{hr.ToString("X8"),version==IntPtr.Zero?"":Marshal.PtrToStringUni(version)}; }
      finally { if(version!=IntPtr.Zero) Marshal.FreeCoTaskMem(version); }
    } finally { FreeLibrary(module); }
  }
}
'@
$runtimeGuid='{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
function Get-RuntimeState([string]$Directory) {
  $loader=(Resolve-Path -LiteralPath (Join-Path $Directory 'WebView2Loader.dll')).Path
  $probe=[LumiseqRuntimeProbe]::Read($loader)
  $versions=@()
  foreach($key in @("HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$runtimeGuid","HKCU:\Software\Microsoft\EdgeUpdate\Clients\$runtimeGuid")) {
    $pv=(Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue).pv
    if($pv -and $pv -ne '0.0.0.0'){$versions+=$pv}
  }
  [PSCustomObject]@{HResult=$probe[0];ApiVersion=$probe[1];RegistryVersions=$versions;Available=($probe[0] -eq '00000000' -and -not [string]::IsNullOrEmpty($probe[1]))}
}
if($Mode -eq 'Probe'){Get-RuntimeState $PackageDirectory | ConvertTo-Json; exit}
if(-not $env:RUNNER_TEMP -or -not $env:GITHUB_WORKSPACE){throw 'Disposable runner paths are missing.'}
$tempRoot=(Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
$work=Join-Path $tempRoot ('lumiseq-clean-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$version=$ReleaseTag.Substring(1)
$setupName="Lumiseq-$version-windows-x64-setup.exe"
$zipName="Lumiseq-$version-windows-x64.zip"
$names=@($setupName,$zipName,'LICENSE','THIRD_PARTY_NOTICES.txt','SHA256SUMS.txt')
$headers=@{'User-Agent'='Lumiseq-clean-acceptance';Accept='application/vnd.github+json'}
$release=Invoke-RestMethod -Uri "https://api.github.com/repos/ky1rie1/Lumiseq/releases/tags/$ReleaseTag" -Headers $headers
if($release.draft -or $release.prerelease -or $release.tag_name -ne $ReleaseTag -or $release.assets.Count -ne 5){throw 'Expected a stable release with exactly five public assets.'}
foreach($name in $names){
  $asset=$release.assets | Where-Object name -CEQ $name
  if(@($asset).Count -ne 1 -or $asset.state -ne 'uploaded'){throw 'Release allowlist mismatch.'}
  $file=Join-Path $work $name
  Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $file
  if($asset.digest -ne 'sha256:'+((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant())){throw "Download digest failed: $name"}
}
$portable=Join-Path $work 'portable'
Expand-Archive -LiteralPath (Join-Path $work $zipName) -DestinationPath $portable
$portableNames=@('lumiseq.exe','WebView2Loader.dll','LICENSE','THIRD_PARTY_NOTICES.txt','README.txt','SHA256SUMS.txt') | Sort-Object
$actualNames=@(Get-ChildItem -LiteralPath $portable -File | Select-Object -ExpandProperty Name | Sort-Object)
if(@(Compare-Object $actualNames $portableNames).Count -or @(Get-ChildItem -LiteralPath $portable -Directory).Count){throw 'Unexpected portable contents.'}
foreach($line in Get-Content -LiteralPath (Join-Path $work 'SHA256SUMS.txt')){
  if($line -notmatch '^([a-f0-9]{64})  ([\w.-]+)$'){throw 'Malformed checksum manifest.'}
  $hash=$Matches[1];$name=$Matches[2]
  $file=if($name -in $names){Join-Path $work $name}elseif($name -in $portableNames){Join-Path $portable $name}else{throw 'Unexpected checksum entry.'}
  if((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash){throw "Checksum failed: $name"}
}
& node (Join-Path $PSScriptRoot 'windows-release.mjs') verify $portable
if($LASTEXITCODE -ne 0){throw 'Portable native dependency gate failed.'}

# The guard above forbids this entire block on a user's PC or self-hosted runner.
# Use Microsoft's own signed uninstaller; do not fake absence by changing registry keys.
$before=Get-RuntimeState $portable
Write-Output ('Initial Runtime: '+($before | ConvertTo-Json -Compress))
$runtimeRoots=@(
  @{Path=(Join-Path ${env:ProgramFiles(x86)} 'Microsoft/EdgeWebView/Application');System=$true},
  @{Path=(Join-Path $env:LOCALAPPDATA 'Microsoft/EdgeWebView/Application');System=$false}
)
foreach($root in $runtimeRoots){
  if(-not (Test-Path -LiteralPath $root.Path)){continue}
  $resolvedRoot=(Resolve-Path -LiteralPath $root.Path).Path
  $installers=@(Get-ChildItem -LiteralPath $resolvedRoot -Directory | Where-Object Name -Match '^\d+\.\d+\.\d+\.\d+$' | Sort-Object { [version]$_.Name } -Descending)
  foreach($directory in $installers){
    $uninstaller=Join-Path $directory.FullName 'Installer/setup.exe'
    if(-not (Test-Path -LiteralPath $uninstaller)){continue}
    $resolved=(Resolve-Path -LiteralPath $uninstaller).Path
    if(-not $resolved.StartsWith($resolvedRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw 'Runtime uninstaller escaped its expected directory.'}
    $signature=Get-AuthenticodeSignature -LiteralPath $resolved
    if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation'){throw 'Runtime uninstaller is not Microsoft-signed.'}
    $arguments='--uninstall --msedgewebview --force-uninstall --verbose-logging'
    if($root.System){$arguments+=' --system-level'}
    $process=Start-Process -FilePath $resolved -ArgumentList $arguments -WindowStyle Hidden -PassThru
    if(-not $process.WaitForExit(60000)){throw 'Runtime removal did not finish.'}
    Write-Output "Microsoft Runtime uninstaller exit: $($process.ExitCode)"
  }
}
$absent=Get-RuntimeState $portable
if($absent.Available -or $absent.RegistryVersions.Count -ne 0 -or $absent.HResult -ne '80070002'){throw ('Runtime absence was not established: '+($absent | ConvertTo-Json -Compress))}
Write-Output ('Confirmed Runtime absent: '+($absent | ConvertTo-Json -Compress))

$installed=Join-Path $work 'installed'
$setup=Start-Process -FilePath (Join-Path $work $setupName) -ArgumentList "/S /NS /D=$installed" -WindowStyle Hidden -PassThru
$deadline=(Get-Date).AddMinutes(10)
while(-not $setup.HasExited -and (Get-Date) -lt $deadline){Start-Sleep -Seconds 1;$setup.Refresh()}
if(-not $setup.HasExited -or $setup.ExitCode -ne 0){throw 'Published installer failed or timed out.'}
$after=Get-RuntimeState $installed
if(-not $after.Available -or $after.RegistryVersions.Count -eq 0){throw 'Installer did not provision a registered Runtime.'}
& node (Join-Path $PSScriptRoot 'windows-release.mjs') verify $installed
if($LASTEXITCODE -ne 0){throw 'Installed native dependency gate failed.'}
foreach($name in @('WebView2Loader.dll','LICENSE','THIRD_PARTY_NOTICES.txt','README.txt')){
  if((Get-FileHash -LiteralPath (Join-Path $installed $name)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $portable $name)).Hash){throw "Installed payload mismatch: $name"}
}

function Test-Application([string]$Directory,[int]$Port){
  $exe=Join-Path $Directory 'lumiseq.exe'
  if((Get-Item -LiteralPath $exe).VersionInfo.FileVersion -notin @($version,"$version.0")){throw 'Application version mismatch.'}
  $oldPath=$env:PATH;$oldArgs=$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
  try{
    $env:PATH="$env:SystemRoot\System32;$env:SystemRoot;$env:SystemRoot\System32\Wbem"
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=$Port --remote-debugging-address=127.0.0.1"
    $stderr=Join-Path $Directory 'acceptance-stderr.txt'
    $stdout=Join-Path $Directory 'acceptance-stdout.txt'
    $app=Start-Process -FilePath $exe -WorkingDirectory $Directory -WindowStyle Hidden -RedirectStandardError $stderr -RedirectStandardOutput $stdout -PassThru
  }finally{$env:PATH=$oldPath;$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=$oldArgs}
  try{
    & node (Join-Path $PSScriptRoot 'windows-home-probe.mjs') $Port
    if($LASTEXITCODE -ne 0){throw 'Application home page did not become ready.'}
    $app.Refresh()
    if($app.HasExited -or $app.MainWindowHandle -eq 0){throw 'Application has no live desktop window.'}
    $loader=@($app.Modules | Where-Object ModuleName -IEQ 'WebView2Loader.dll')
    if($loader.Count -ne 1 -or $loader[0].FileName -ne (Join-Path $Directory 'WebView2Loader.dll')){throw 'Application did not load its own package DLL.'}
    Write-Output "Application startup passed: $([IO.Path]::GetFileName($Directory)); version $version; own-directory Loader; rendered home page."
  }catch{
    $app.Refresh()
    Write-Output ('Startup process state: '+([PSCustomObject]@{Exited=$app.HasExited;ExitCode=$(if($app.HasExited){$app.ExitCode}else{$null});WindowHandle=$app.MainWindowHandle.ToInt64()} | ConvertTo-Json -Compress))
    Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | ForEach-Object {
      [PSCustomObject]@{WebViewProcess=$_.ProcessId;Parent=$_.ParentProcessId;Session=$_.SessionId;DebugPortPresent=$_.CommandLine.Contains("--remote-debugging-port=$Port")} | ConvertTo-Json -Compress
    }
    foreach($log in @($stderr,$stdout,(Join-Path $env:LOCALAPPDATA 'AI-Creative-Studio/logs/startup.log'))){
      if(Test-Path -LiteralPath $log){Get-Content -LiteralPath $log | Select-Object -Last 12}
    }
    try{$targets=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 3; $targets | Select-Object type,url,title | ConvertTo-Json -Compress}catch{Write-Output 'Loopback WebView debugger is not available.'}
    throw
  }finally{if(-not $app.HasExited){Stop-Process -Id $app.Id}}
}
Test-Application $installed 19227
Test-Application $portable 19228
Write-Output ('Provisioned Runtime: '+($after | ConvertTo-Json -Compress))
if($env:GITHUB_STEP_SUMMARY){
  @"
## Windows release acceptance: $ReleaseTag

Environment: disposable GitHub-hosted Windows Server VM. Downloads: exact public release files, verified SHA-256. No local user files or screenshots are uploaded.

| Check | Result |
| --- | --- |
| Runtime absent before installation | Loader HRESULT $($absent.HResult), no Runtime registration |
| Published setup | Exit 0; Runtime $($after.ApiVersion) installed automatically |
| Installed application | Expected version, package Loader, rendered home page |
| Portable application | Expected version, package Loader, rendered home page |

This verifies the online provisioning path. It does not claim offline installation or coverage of all consumer Windows versions.
"@ | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY
}
