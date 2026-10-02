# GitHub 发布指南

## 发布前检查

```powershell
npm ci
npm run typecheck
npm test
npm run repo:check
git status --short
```

源码、测试、锁文件、图标、字体、LibRaw 源码和必需静态库进入 Git。模型权重、EXE、依赖、缓存、生成测试输出、会话、内部工作笔记和验收记录由 `.gitignore` 排除。`repo:check` 也拒绝这些文件进入索引。

首次公开源码使用不带本地开发历史的发布提交。本地旧分支保留用于恢复；只推送公开的 `main`，不要使用 `git push --all` 或推送内部旧分支。忽略规则不能删除旧提交中的文件。

## 首次推送

在 GitHub 创建空仓库，然后在本项目目录执行：

```powershell
git add .
git diff --cached --stat
git commit -m "chore: prepare Lumiseq source release"
```

从 GitHub 复制仓库 URL，使用 `git remote add origin <仓库URL>` 配置远程，再执行：

```powershell
git push -u origin HEAD
```

该命令推送当前分支。推送前用 `git branch --show-current` 确认分支名称，并在 GitHub 上选择相应的默认分支。已经整理并提交的版本无需重复创建初始化提交。

使用自己的 Git 提交姓名与邮箱。本地整理与发布构建不会自动创建远程或推送。

## 构建发布文件

```powershell
npm run model:download
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-cargo.ps1 test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -Publish
npm run release:prepare
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-installer.ps1
```

输出目录为 `artifacts/windows/`：

| 文件 | 用途 |
| --- | --- |
| `lumiseq.exe` | 带内置界面和抠图模型的 Windows GUI 程序 |
| `WebView2Loader.dll` | 与 EXE 同目录的 x64 WebView2 加载器，GNU 版必需 |
| `Lumiseq-<版本>-windows-x64-setup.exe` | 推荐下载，包含 Loader；检测并安装缺失的 WebView2 Runtime（需联网） |
| `Lumiseq-<版本>-windows-x64.zip` | 便携包，含 EXE、Loader、许可证、通知、说明及校验清单；需已有 Runtime |
| `SHA256SUMS.txt` | EXE、Loader、许可、说明与完整 ZIP 的校验和 |
| `THIRD_PARTY_NOTICES.txt` | 从锁定依赖生成的完整许可声明 |

发布附件使用白名单：安装包、完整 ZIP、`LICENSE`、第三方声明与校验清单。EXE 和 DLL 成对包含在包中，不再提供容易被单独下载的裸 EXE。便携用户须完整解压，保留 DLL 与 EXE 同目录。本机 `builds.json` 是构建历史，不作为发布附件。程序与安装包目前未进行代码签名。

`build-release.ps1` 校验原生导入并同时复制 EXE 和 Loader；`release:prepare` 拒绝缺失文件或架构不匹配，再按明确文件清单创建 ZIP，避免包含缓存与记录。外部 `SHA256SUMS.txt` 包含 ZIP 校验和，ZIP 内清单只校验所包含的其他文件。

`package-installer.ps1` 使用 Tauri 官方 NSIS 模板与嵌入式 WebView2 引导程序，检查原生产物与便携产物哈希一致。安装器按当前用户安装，并将许可证、通知和说明放入安装目录。最终外部校验清单还包括安装包哈希。

## 桌面验收

关闭开发服务器，用发布 EXE 检查：

- 打开图片和 RAW，切换工作区与多个文档标签。
- 修改、撤销、重做，关闭未保存文档。
- 自动抠图、精修、应用蒙版及撤销。
- 智能对象滤镜添加、启停、调参、排序和删除。
- 保存、完全退出、重新打开工程及最近项目。
- 图像导出、RAW 原始分辨率导出。
- 窗口拖动、缩放、最大化和关闭保护。

`npm test` 与 CI 的结果不代替桌面和真实图像质量验收。

发布修复必须重新下载上传后的 ZIP 和安装包，核对远端哈希。便携程序需在仅包含 Windows 系统目录的 PATH 下启动，核对加载的 Loader 来自解压目录；安装包需核对实际安装文件与首页。缺少 Runtime 的分支应在干净 Windows 环境验收，不能用已有 Runtime 的开发机启动代替。

## 版本发布

更新 `package.json`、`src-tauri/Cargo.toml` 与对应锁文件版本，记录 `CHANGELOG.md` 和 `docs/releases/` 说明。确认源码提交与成品对应后创建版本标签和 GitHub Release。

根 MIT 许可证覆盖原创代码。发布二进制时保留 [第三方声明](../THIRD_PARTY_NOTICES.md)、依赖许可与对应 LibRaw 源码。
