<div align="center">

<img src="docs/assets/readme-banner.svg" alt="Lumiseq: the flowing silver LS signature and custom line wordmark. Photography. Layers. Intelligence." width="100%" />

### Lumiseq · 影序

RAW photography, layered editing and AI collaboration in one creative workspace.

[简体中文](README.md) · **English**

[Quick Start](#quick-start) · [Architecture](#editing-architecture) · [AI / MCP](docs/MCP.md) · [Docs](docs/README.md) · [Changelog](CHANGELOG.md)

<img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-30363d?style=flat-square" />
<img alt="Version 0.9.5" src="https://img.shields.io/badge/version-0.9.5-58666d?style=flat-square" />
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-30363d?style=flat-square" /></a>

</div>

---

## One Workspace, Three Ways to Create

Lumiseq is a desktop imaging workspace for **Windows x64**. RAW development preserves source files and adjustment parameters; image editing preserves layers and masks. AI uses the same editing commands, so its changes remain traceable and undoable.

### RAW · Start with the Light

LibRaw camera decoding, exposure, white balance, HSL, curves and local adjustments form a workflow from the original capture to export.

- Full-image dehazing, wavelet denoising and sharpening, with original-resolution PNG16 / JPEG8 output.
- Presets, snapshot comparisons and module-based parameter copying; the target photo's white balance is preserved by default.
- Numeric curve-point editing and arrow-key adjustments, with one undo step per continuous interaction.

### Layers · Keep the Process in the Project

Layers, nested groups, blend modes, selections and masks provide the editing foundation. Brushes, retouching and editable Smart Object filters support further refinement.

- Recursive duplication, inherited group locks, keyboard navigation, canvas alignment and center-preserving flips.
- Filters can be edited, enabled, reordered and removed. Local automatic cutout and edge refinement share one workflow.
- Native projects preserve layers and assets; see the [PSD compatibility guide](docs/PSD_COMPATIBILITY.md) for layered PSD round-trip limits.

### Intelligence · Bring AI into the Workflow

The embedded assistant connects to a configured API or compatible local Codex, Claude Code or Antigravity client. External tools can control Lumiseq through MCP. The UI and AI share documents, permissions and command history.

- Observe the whole image first, then inspect regions in original-image coordinates and **1:1 details**, keeping coordinates tied to the document version.
- Check exact edits against actual parameters. Compare visual changes before and after, retaining explicit states for insufficient evidence or unverified results.
- Exploration offers the original and up to two rendered candidates. An accepted direction can be undone as a whole.
- Users explicitly save photography and layout preferences to carry their style into later tasks.

[AI operations, observation and creative workflows →](docs/MCP.md)

## Keep Creating, Keep It Local

**Workspaces follow your work.** Open documents stay in the tab bar when switching between Home, image editing and RAW development. Graphite and silver controls, icon toolbars and integrated window controls follow one visual system. Brief hover, press and focus feedback can be reduced or disabled.

**Save the source and the process.** Native projects retain RAW references, adjustments, local masks and snapshots, or editing layers and assets. Recovery, atomic saves and unsaved-document prompts protect ongoing work.

**Connect when needed.** Release builds embed BiRefNet Lite 512 for offline cutout, with WebGPU detection and CPU fallback. AI connection checks report the installed client's actual interface capabilities. Windows DPAPI encrypts API keys, and image uploads follow the configured authorization policy. See [providers and vision fallback](docs/PROVIDERS.md).

## Quick Start

### Run the Desktop App

Lumiseq targets Windows x64. The executable, license notices and checksum manifest can be distributed as GitHub Releases attachments. Executables and model weights are excluded from the source repository. See the [release guide](docs/GITHUB_RELEASE.md) for building and distribution.

### Run from Source

Requires Node.js **22.12+**, Rust **1.85+**, MinGW GCC **13+**, PowerShell and WebView2. See the [development guide](docs/DEVELOPMENT.md) for complete setup instructions.

```powershell
npm ci
npm run model:download
. .\scripts\dev-env.ps1
npm run tauri:dev
```

Model downloads validate a pinned revision, file size and SHA-256. Tauri embeds the frontend and model in the app; Vite supports desktop development and acceptance checks.

<details>
<summary><strong>Checks and release builds</strong></summary>

```powershell
npm run typecheck
npm test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-cargo.ps1 test
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -Publish
npm run release:prepare
```

Build output goes to `artifacts/windows/`. See the [release guide](docs/GITHUB_RELEASE.md) for the initial push, version tags and publication steps.

</details>

## Editing Architecture

**Different entry points, shared editing core.** React workspaces call operation services; the embedded AI and external MCP clients call canonical tools. Document mutations converge on `CommandBus`, which updates the saveable state managed by `DocumentManager`.

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-architecture-dark.svg" />
  <img src="docs/assets/readme-architecture-light.svg" alt="Workspace operation services and AI/MCP canonical tools converge on CommandBus and DocumentManager. Rendering, assets and project persistence consume document state; Tauri/Rust provides native services." width="800" />
</picture>

</div>

**Documents and pixels.** `EditDocument` holds layers, selections and masks; `DevelopDocument` holds RAW adjustments. Rendering, asset management and project persistence consume document state. Tauri / Rust supplies LibRaw, filesystem access and secure storage. Preview caches and temporary images are separate from project data.

**AI and evidence.** The harness supplies `AgentRuntime` with operating instructions, task budgets and result verification. Observation reuses document rendering for overviews, regions in source coordinates and 1:1 details. It checks versions before and after rendering, and reviews editing results in a separate context. Tool success, parameter correctness and aesthetic judgments are recorded separately.

**Adding a complete capability.** Data model → undoable command → preview and export → project persistence → UI controls → AI / MCP tools. The Smart Object filter tools `studio_add_smart_filter` and `studio_manage_smart_filter` follow this path.

[Full architecture and module boundaries →](docs/ARCHITECTURE.md) · [AI / MCP interfaces →](docs/MCP.md)

## Repository Map

| Area | Main Modules | Responsibility |
| :--- | :--- | :--- |
| Workspace | `src/ui/` · `src/app/` | UI, settings, files and desktop lifecycle |
| Editing core | `src/document/` · `src/commands/` · `src/history/` | Documents, undoable commands and transactions |
| Imaging | `src/edit/` · `src/develop/` · `src/engine/` | Layer operations, RAW parameters, previews and compositing |
| AI collaboration | `src/ai/` | Providers, runtime, harness, vision, canonical tools and MCP |
| Native services | `src/platform/` · `src-tauri/` | Host interfaces, LibRaw, files and secure storage |
| Development and verification | `scripts/` · `tests/` · `integration/` | Builds, repository checks, regressions and real-image acceptance |
| Documentation | `docs/` | Usage, technical methods and release records |

## Current Limits

- **RAW and color:** Reopening a RAW project requires the original camera file at its saved path. RAW PNG output is 16-bit sRGB; Canvas exports from image editing are 8-bit. Custom camera DCP/ICC profiles, wide-gamut scene spaces, print soft proofing and camera/ISO noise calibration are not currently supported.
- **Chart validation:** Two public Nikon Z7 chart samples have been compared with their publisher's RawTherapee renders. These results measure rendering consistency for those samples; calibrated physical chart accuracy remains unverified. See the [measurement methods and data](docs/technical/COLOR_PARITY.md).
- **Complex editing:** PSD has explicit [compatibility limits](docs/PSD_COMPATIBILITY.md). Hair, glass, motion blur and complex backgrounds may need manual refinement.
- **Agent vision:** Image support depends on the installed CLI and model. A configured vision fallback can assist clients without image support, subject to upload authorization. An interface probe does not establish real-model visual understanding. See [connection capabilities and verification limits](docs/PROVIDERS.md).

## Contributing and Licensing

Reproducible issues and focused improvements are welcome. [Contributing](CONTRIBUTING.md) · [Security and privacy](SECURITY.md) · [Documentation index](docs/README.md)

Original Lumiseq code is licensed under **[MIT](LICENSE)**. LibRaw, fonts, models and other dependencies retain their own licenses. See [third-party notices](THIRD_PARTY_NOTICES.md).
