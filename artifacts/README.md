# 发布产物 / Release

`windows/lumiseq.exe` 是本机 Windows 发布程序，内置离线抠图模型。GNU 版需要同目录的 x64 `WebView2Loader.dll`。`release:prepare` 创建完整便携 ZIP；程序、DLL、ZIP 和本机 `builds.json` 均被 Git 忽略。仅把明确的公开发布附件上传到 GitHub Release，不上传构建历史。步骤见 [发布指南](../docs/GITHUB_RELEASE.md)。

`package-installer.ps1` 另生成按当前用户安装的 NSIS 包，包含配套 DLL，并通过微软引导程序配置缺失的 Runtime。GitHub 仅上传安装包、完整 ZIP、许可证、通知和校验清单。

`windows/lumiseq.exe` is the local Windows release build with offline cutout embedded. The GNU build requires its matching x64 `WebView2Loader.dll` beside it. Release preparation creates a complete portable ZIP; the NSIS installer provisions a missing Runtime with Microsoft's bootstrapper. Executables, DLLs, ZIPs and build history stay out of source Git. Only the installer, ZIP, licenses, notices and checksums are public release assets.
