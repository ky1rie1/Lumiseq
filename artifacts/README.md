# 发布产物 / Release

本地当前程序统一使用 `windows/lumiseq.exe`，内置离线抠图模型，配套 x64 `WebView2Loader.dll` 放在同目录。不要用临时修复名称区分日常运行入口；构建内容、状态和校验值写在同目录的 `README.txt` 和 `SHA256SUMS.txt` 中。

| 路径 | 用途 |
| --- | --- |
| `windows/lumiseq.exe` | 当前运行程序 |
| `windows/WebView2Loader.dll` | 当前程序必需的应用依赖 |
| `windows/README.txt` | 当前构建的运行说明与发布状态 |
| `windows/LICENSE`、`windows/THIRD_PARTY_NOTICES.txt` | 当前程序的许可声明 |
| `windows/SHA256SUMS.txt` | 当前文件校验值 |

本地运行目录只保留当前程序及其配套文件；已被替代的程序、安装包、便携 ZIP 和旧校验清单及时清理。正式打包会生成新的安装包和完整 ZIP，它们是交付附件。本地验收构建可能沿用旧版二进制版本号，不能仅凭版本号判断它与 GitHub Release 内容一致。正式发布前，从当前源码重新构建并执行 `release:prepare`，生成配套声明、校验清单和完整便携 ZIP。程序、DLL、ZIP 和本机 `builds.json` 均被 Git 忽略。仅把明确的公开发布附件上传到 GitHub Release，不上传构建历史。步骤见 [发布指南](../docs/GITHUB_RELEASE.md)。

`package-installer.ps1` 另生成按当前用户安装的 NSIS 包，包含配套 DLL，并通过微软引导程序配置缺失的 Runtime。GitHub 仅上传安装包、完整 ZIP、许可证、通知和校验清单。

`windows/lumiseq.exe` is the single current application entry, with offline cutout embedded and its matching x64 `WebView2Loader.dll` beside it. `README.txt` identifies the actual build and publication status; `SHA256SUMS.txt` identifies its files. Remove superseded programs, installers, portable ZIPs and checksum lists from the local runtime directory. Packaging generates new installers and ZIPs for delivery. A local acceptance build can keep an older binary version, so that version alone does not establish equivalence with a published Release.

Rebuild from current source before release preparation. It creates a complete portable ZIP and matching notices/checksums; the NSIS installer provisions a missing Runtime with Microsoft's bootstrapper. Executables, DLLs, ZIPs and build history stay out of source Git. Only the installer, ZIP, licenses, notices and checksums are public release assets.
