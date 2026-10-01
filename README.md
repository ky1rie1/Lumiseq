<div align="center">

<img src="docs/assets/readme-banner.svg" alt="影序 Lumiseq：流动的 LS 银色标识与线条字标。Photography. Layers. Intelligence." width="100%" />

### 影序 · Lumiseq

照片调色、分层编辑与 AI 协作，共用一张创作工作台。

**简体中文** · [English](README.en.md)

[快速开始](#快速开始) · [编辑架构](#编辑架构) · [AI / MCP](docs/MCP.md) · [文档](docs/README.md) · [更新记录](CHANGELOG.md)

<img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-30363d?style=flat-square" />
<img alt="Version 0.9.5" src="https://img.shields.io/badge/version-0.9.5-58666d?style=flat-square" />
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-30363d?style=flat-square" /></a>

</div>

---

## 一张工作台，三种创作方式

Lumiseq 是面向 **Windows x64** 的桌面影像工作台。RAW 调色保留原始素材与参数，图像编辑保留图层与蒙版；AI 通过同一套编辑命令完成操作，修改可追溯、可撤销。

### RAW · 从原始光线开始

LibRaw 相机解码，配合曝光、白平衡、HSL、曲线和局部调整，完成从原片到输出的调色流程。

- 全图去雾、小波降噪、锐化，以及原始分辨率 PNG16 / JPEG8 输出。
- 预设、快照对比和按模块复制参数；默认保留目标照片白平衡。
- 曲线控制点支持数字输入、方向键微调，一次连续操作对应一次撤销。

### Layers · 让编辑过程留在作品里

图层、嵌套分组、混合模式、选区与蒙版组成编辑基础，画笔、修饰和智能对象滤镜用于继续打磨。

- 递归复制、父组锁定、键盘导航、画布对齐与中心翻转。
- 滤镜可修改、启停、排序和删除；本地自动抠图与边缘精修集成在同一流程。
- 原生项目保存图层与资源；分层 PSD 的往返能力见 [兼容说明](docs/PSD_COMPATIBILITY.md)。

### Intelligence · AI 进入编辑流程

内置助手可连接自选 API 或兼容的 Codex、Claude Code、Antigravity 本机客户端，外部工具可通过 MCP 操作 Lumiseq。界面与 AI 共用文档、权限和命令历史。

- 先观察整图，再按原图坐标查看局部和 **1:1 细节**，保持坐标与文档版本一致。
- 精确操作核对实际参数；视觉任务比较修改前后，保留证据不足与尚未验证的状态。
- 探索模式提供原稿与最多两个实际渲染候选，接受后可整次撤销。
- 摄影与排版偏好由用户明确保存，帮助后续任务延续自己的风格。

[AI 操作、观察与创作指南 →](docs/MCP.md)

## 连续创作，本地优先

**工作区随你切换。** 文档保留在标签栏，首页、图像编辑与照片调色之间切换时继续原有会话。石墨灰与银色控件、图标工具栏和融入工作台的窗口控制保持一致；短暂的悬停、按下与焦点反馈支持减少或关闭动效。

**素材与过程一起保存。** RAW 来源、参数、局部蒙版和快照，以及图像编辑的图层与资源可保存在原生项目中。自动恢复、原子保存和未保存文档关闭提示保护编辑过程。

**需要时再连接。** 发布程序内置 BiRefNet Lite 512，抠图可离线运行，支持 WebGPU 探测与 CPU 回退。AI 连接检查报告当前客户端的实际接口能力；API Key 使用 Windows DPAPI 加密保存。图像上传遵守所配置的授权策略，连接与视觉后备服务见 [模型服务指南](docs/PROVIDERS.md)。

## 快速开始

### 使用桌面程序

本项目面向 Windows x64。发布程序、许可文本与校验清单可作为 GitHub Releases 附件分发；源码仓库不包含 EXE 或模型权重。构建与分发方法见 [发布指南](docs/GITHUB_RELEASE.md)。

### 从源码启动

需要 Node.js **22.12+**、Rust **1.85+**、MinGW GCC **13+**、PowerShell 与 WebView2。完整环境配置见 [开发指南](docs/DEVELOPMENT.md)。

```powershell
npm ci
npm run model:download
. .\scripts\dev-env.ps1
npm run tauri:dev
```

模型下载校验固定 revision、文件大小和 SHA-256。Tauri 将界面与模型打包到程序中，Vite 用于桌面开发和验收。

<details>
<summary><strong>检查与发布构建</strong></summary>

```powershell
npm run typecheck
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-cargo.ps1 test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -Publish
npm run release:prepare
```

成品输出至 `artifacts/windows/`。首次推送、版本标记和发布步骤见 [发布指南](docs/GITHUB_RELEASE.md)。

</details>

## 编辑架构

**不同入口，共用编辑内核。** React 工作区调用操作服务，内置 AI 和外部 MCP 调用规范工具；文档写操作汇入 `CommandBus`，再更新 `DocumentManager` 中的可保存状态。

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-architecture-dark.svg" />
  <img src="docs/assets/readme-architecture-light.svg" alt="工作区操作服务与 AI／MCP 规范工具汇入 CommandBus，更新 DocumentManager，再由渲染、资源及项目存储消费文档；Tauri／Rust 提供原生能力。" width="800" />
</picture>

</div>

**文档与像素。** `EditDocument` 保存图层、选区与蒙版，`DevelopDocument` 保存 RAW 调色参数。渲染、资源管理和项目存储消费文档状态，Tauri / Rust 提供 LibRaw、文件系统和安全存储。预览缓存与临时图像不充当工程数据。

**AI 与证据。** Harness 为 `AgentRuntime` 提供操作指南、任务预算和结果复核。观察服务复用文档渲染，读取整图、原坐标区域与 1:1 细节；修改前后检查版本，独立复核操作结果。工具成功、参数正确和主观审美分别记录。

**新增能力的完整路径。** 数据结构 → 可撤销命令 → 预览与导出 → 项目存储 → 界面控件 → AI / MCP 工具。智能滤镜的 `studio_add_smart_filter` 和 `studio_manage_smart_filter` 已沿用这一路径。

[完整架构与模块边界 →](docs/ARCHITECTURE.md) · [AI / MCP 接口 →](docs/MCP.md)

## 仓库地图

| 区域 | 主要模块 | 职责 |
| :--- | :--- | :--- |
| 工作台 | `src/ui/` · `src/app/` | 界面、设置、文件与桌面生命周期 |
| 编辑内核 | `src/document/` · `src/commands/` · `src/history/` | 文档、可撤销命令与事务 |
| 影像处理 | `src/edit/` · `src/develop/` · `src/engine/` | 图层操作、RAW 参数、预览与合成 |
| AI 协作 | `src/ai/` | Provider、Runtime、harness、视觉、规范工具与 MCP |
| 原生能力 | `src/platform/` · `src-tauri/` | 宿主接口、LibRaw、文件与安全存储 |
| 开发与验证 | `scripts/` · `tests/` · `integration/` | 构建、仓库检查、回归与真实图像验收 |
| 项目文档 | `docs/` | 使用说明、技术方法与发布记录 |

## 当前边界

- **RAW 与色彩：** 重开 RAW 项目需要原始相机文件仍在保存路径。RAW PNG 为 16 位 sRGB，图像编辑 Canvas 导出为 8 位；当前不支持自定义相机 DCP/ICC、宽色域场景空间、打印软打样或机型 / ISO 噪声标定。
- **色卡验证：** 两组公开 Nikon Z7 样本已与发布者的 RawTherapee 渲染比较。这是特定样本的渲染一致性结果，物理色卡色准尚未完成校准验证。[测量方法与数据](docs/technical/COLOR_PARITY.md)。
- **复杂编辑：** PSD 仍有明确的 [兼容范围](docs/PSD_COMPATIBILITY.md)。发丝、玻璃、运动模糊与复杂背景可能需要人工精修。
- **Agent 视觉：** 图片通道取决于实际 CLI 与模型；不支持时可配置视觉后备服务，仍遵守上传授权。安装接口检测不代表真实模型视觉理解已通过验收。[连接能力与验证边界](docs/PROVIDERS.md)。

## 参与与授权

欢迎提交可复现的问题和范围明确的改进。[贡献指南](CONTRIBUTING.md) · [安全与隐私](SECURITY.md) · [文档导航](docs/README.md)

原创 Lumiseq 代码采用 **[MIT](LICENSE)**。LibRaw、字体、模型及其他依赖保留各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。
