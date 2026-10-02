# 启动故障排查 / Startup Troubleshooting

排查前先确认使用的版本、下载来源和 [最新修改](../CHANGELOG.md)。截图、运行日志、用户工程和个人素材仅在用户明确授权时分享，不随源码推送。

## 找不到 WebView2Loader.dll

**表现：** Windows 提示 `lumiseq.exe` 无法继续执行代码，因为找不到 `WebView2Loader.dll`；重新安装 WebView2 提示系统已安装 Runtime。

**原因：** Runtime 是浏览器运行环境；Loader 是应用使用的原生入口组件。Windows GNU 版 Lumiseq 动态依赖 x64 Loader，发布时必须随 EXE 分发。安装 Runtime 不会修复遗漏的应用 DLL。旧版 0.9.5 EXE 单文件分发遗漏了它。

**处理：**

1. 获取项目 [发布页](https://github.com/ky1rie1/Lumiseq/releases/latest)上的 Windows x64 安装包，或完整解压便携 ZIP 到本地文件夹。
2. 确认 `lumiseq.exe` 和配套的 `WebView2Loader.dll` 位于同一目录，再运行 EXE。不要直接从 ZIP 内打开或只移动 EXE。
3. 已下载旧 EXE 时，建议更新到 0.9.7 完整包。若解压后 DLL 消失，检查安全软件的隔离记录，不要关闭防护。
4. Runtime 缺失时，运行安装包：它会检测并调用内置的微软引导程序，联网安装 [Evergreen WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)。便携包不执行系统环境安装；已有 Runtime 时无需重新安装。

不要从第三方 DLL 网站取文件，也无需将 DLL 复制到 `System32` 或执行 `regsvr32`。

目录应至少包含：

```text
Lumiseq/
  lumiseq.exe
  WebView2Loader.dll
  LICENSE
  THIRD_PARTY_NOTICES.txt
  README.txt
  SHA256SUMS.txt
```

可使用 `Get-FileHash .\WebView2Loader.dll -Algorithm SHA256` 与发布的校验清单核对。复测时说明错误是否消失、是否打开首页、Windows 版本，以及下载的发布版本。

## English

An installed WebView2 Runtime and a missing `WebView2Loader.dll` can occur together. The Runtime is the browser environment; the Loader is an application dependency that must match the app's architecture. This Windows GNU build uses the x64 loader.

Use the 0.9.7 installer, or extract the complete portable package into a local directory. Keep `lumiseq.exe` and the provided `WebView2Loader.dll` together. Replace the original EXE-only 0.9.5 download with a complete package. If extraction removes the DLL, inspect security-software quarantine history without disabling protection.

The installer detects WebView2 Runtime and runs Microsoft's embedded bootstrapper when it is absent; this needs internet access. The portable ZIP expects an existing Runtime. Do not use unrelated DLL download sites, copy the loader to System32, or register it with `regsvr32`. Verify the SHA-256 manifest before sharing a package.

Reference: [Microsoft WebView2 files to ship](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#files-to-ship-with-the-app).
