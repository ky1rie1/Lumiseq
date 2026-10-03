<div align="center">

<img src="docs/assets/readme-banner.svg" alt="Lumiseq: silver LS symbol and wordmark. Photo editor." width="100%" />

A Windows photo editor for RAW development, layers and AI-assisted editing.

[简体中文](README.md) · **English**

[Download](#download-and-install) · [Features](#features) · [Architecture](#architecture) · [Docs](docs/README.md) · [Changelog](CHANGELOG.md)

<img alt="Windows x64" src="https://img.shields.io/badge/Windows-x64-30363d?style=flat-square" />
<a href="https://github.com/ky1rie1/Lumiseq/releases/tag/v0.9.7"><img alt="Version 0.9.7" src="https://img.shields.io/badge/version-0.9.7-58666d?style=flat-square" /></a>
<a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-30363d?style=flat-square" /></a>

</div>

## Download and install

[**Download Lumiseq 0.9.7 · Windows x64**](https://github.com/ky1rie1/Lumiseq/releases/tag/v0.9.7)

Use `Lumiseq-0.9.7-windows-x64-setup.exe`. It includes the required application DLL and checks for WebView2 Runtime, running Microsoft's bootstrapper when the Runtime is absent. Provisioning a missing Runtime requires internet access. Node.js and Rust are not required.

The portable ZIP is available for machines with [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/#download-section) already installed. **Extract the entire package** before running `lumiseq.exe`, and keep `WebView2Loader.dll` beside it.

If Windows reports a missing `WebView2Loader.dll`, restore it from the application package. Reinstalling the Runtime does not supply the application's loader. See [startup troubleshooting](docs/TROUBLESHOOTING.md).

The [release page](https://github.com/ky1rie1/Lumiseq/releases/latest) includes third-party notices and SHA-256 checksums. The executable is currently unsigned. The local cutout model is bundled; the AI assistant requires your own API connection or a compatible local client.

## Features

### RAW development

LibRaw camera decoding, exposure, white balance, HSL, curves and local adjustments, plus full-image dehazing, wavelet denoising and sharpening. The development candidate preserves float working data and adds original-size PNG16/TIFF16, sRGB/Display P3 and embedded Sony lens corrections. JPEG remains 8-bit.

Presets, snapshots and module-based parameter copying support editing a series of photos. Curve points accept numeric input and arrow-key adjustments; a continuous drag produces one undo entry. Keep the original camera file available when reopening a RAW project.

### Image editing

Layers and nested groups, blend modes, selections, masks, brushes and retouching tools. Duplicate, lock, align and flip layers, or edit and reorder Smart Object filters.

Automatic cutout and edge refinement share one interface and work offline. Native projects preserve layers and assets; see [PSD compatibility](docs/PSD_COMPATIBILITY.md) for import and export limits. Open documents stay in the tab bar when switching between Home, image editing and RAW development.

### AI collaboration

In-app chat connects to your API or a compatible local Codex, Claude Code or Antigravity client. External agents can also control the app through MCP. See the [connection guide](docs/PROVIDERS.md) for supported interfaces and image channels.

AI starts with an overview, then inspects regions in source coordinates and at 1:1 resolution. Edits use the same undoable commands as the UI. The harness checks parameters and compares results before and after editing. Exploration offers the original and up to two rendered candidates; users can choose a result and save photography or layout preferences.

[AI operations and observation](docs/MCP.md) · [Security and privacy](SECURITY.md)

## Architecture

React provides the workspace; Tauri / Rust supplies native services. The UI calls operation services, while AI and MCP call canonical tools. Document mutations pass through `CommandBus` to the state held by `DocumentManager`, which rendering, assets and project storage consume.

<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme-architecture-dark.svg" />
  <img src="docs/assets/readme-architecture-light.svg" alt="Editor → Operations; AI / Agent and MCP → Canonical tools. Both paths pass through CommandBus to DocumentManager, then Render, Assets and Project. Tauri / Rust and LibRaw supply native services." width="800" />
</picture>

</div>

RAW parameters, layers and masks are project data. The AI harness supplies operating instructions, observation budgets, document version checks and result review. New editing capabilities need commands, previews, exports, persistence and AI tools.

[Module boundaries and data flow](docs/ARCHITECTURE.md)

## Known limitations

- See [RAW camera compatibility](docs/RAW_COMPATIBILITY.md) for tested models and unsupported compression variants. Recognizing an extension does not establish universal camera support.
- The current development source uses extended linear sRGB float pixels for RAW and new layered documents, with PNG/TIFF16 delivery; legacy projects keep their renderer. RAW smart objects retain originals and recipes; see [editor precision](docs/technical/EDIT_PRECISION.md). Published 0.9.7 installers still use the earlier implementation until a new release is made. Custom camera DCP/ICC profiles, floating sensor DNG, print soft proofing and camera/ISO noise calibration remain unsupported. Adobe rendering equivalence is not claimed.
- Color validation compares two public Nikon Z7 samples against RawTherapee renders. It does not establish calibrated physical chart accuracy. See [methods and data](docs/technical/COLOR_PARITY.md).
- Hair, glass, motion blur and complex backgrounds may need manual cutout refinement. PSD support also has explicit compatibility limits.
- Agent image support depends on the client and model. A successful connection probe does not verify real-model visual understanding. Vision fallback services follow the configured image-upload permissions.

## Development and contributing

See the [development guide](docs/DEVELOPMENT.md) for source setup and build commands. When reporting an issue, include the app version, steps to reproduce and expected result.

[Contributing](CONTRIBUTING.md) · [Documentation index](docs/README.md) · [Release process](docs/GITHUB_RELEASE.md)

## License

Original Lumiseq code is licensed under [MIT](LICENSE). LibRaw, fonts, models and other dependencies retain their own licenses. See [third-party notices](THIRD_PARTY_NOTICES.md).
