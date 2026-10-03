# Changelog

## Unreleased - RAW detail, automatic tone and workspace interactions

- Correct the version-2 contrast pivot at 18% linear gray: positive contrast darkens lower tones and brightens upper tones rather than increasing the whole image's exposure. Refine highlight targeting and useful shadow lift consistently across CPU, GPU and native delivery.
- Present only decoded working RAW in the adjustment canvas. Loading, restored cached previews and first-render failures cannot expose a camera JPEG or stale photo before editable pixels are painted. Automatic tone and export wait for the rendered preview.
- Fit exposure, contrast, highlights, shadows, whites and blacks jointly from bounded native float samples. Preserve white balance, curves, HSL and local masks; distinguish low-key scenes and reject stale or cancelled analysis before one undoable commit.
- Add a separate rendering version for normalized Gaussian/guided luminance detail, sequential sharpening, noise transitions and point-light halo control. New documents use version 2; existing documents and resets retain their version. An explicit upgrade creates a separate document with the same RAW decoding and mask coordinates.
- Match CPU, GPU and native tone/detail ordering, including extended-range HSL and complete region/stripe support. Add actual WebView2 round-point, rotation, signed/HDR and useful-strength regressions.
- Add command-backed canvas, layer, RAW module, parameter and curve context menus with target validation, inherited locks, keyboard navigation and focus restoration. Add canonical AI/MCP automatic tone, rendering upgrade and grouped reset tools.
- Check the official GitHub release list with bounded requests, ETag caching, daily automatic checks and explicit offline/rate-limit states. Show update notes and complete Windows installer/ZIP entry points; distinguish development builds and allow automatic checks to be disabled.
- Keep private camera files and generated validation outputs outside published source. Full-size Sony validation and current limitations are recorded in [RAW quality](docs/RAW_QUALITY.md).

## Unreleased — RAW quality and compatibility

- Remove nine unreferenced legacy modules, including the early RAW shader, duplicate AI tool registry and retired settings dialogs. Active processing, provider and settings entry points remain covered by their existing regressions.
- Decode camera-space samples before float white balance and camera-to-working conversion. New RAW projects use RGBA32F working pixels, LF32 overview/tile transport and verified RGBA32F GPU targets; signed gamut and highlight headroom survive until delivery. Existing projects retain processing version 1.
- Apply Sony active crop and embedded distortion, chromatic aberration and shading tables. Correct the A6700 sample to 6192×4128; bounds-safe sensor mapping avoids invented black borders.
- Add a reversible separate RAW variant for uncorrected inspection or explicit legacy-project upgrade. Preserve the original project; refuse coordinate migration with local masks. Persist correction mode/provenance and expose the same operation through AI/MCP.
- Add native TIFF16 and sRGB / Display P3 ICC output to the export dialog and existing AI export tool. Diagnostic linear TIFF32F retains signed values. Camera demosaic remains integer; floating sensor DNG is explicitly rejected rather than silently quantized.
- Add GoPro GPR sensor decoding through the pinned official SDK and enable Sigma X3F. Correct monochrome output and fourth-color-plane opacity; validate native buffer dimensions, channels and length before conversion.
- Keep RAW import working when an embedded thumbnail is unavailable. Share the RAW extension catalog across frontend routing, native dialogs and project recovery; include Sinar STI and remove video-only R3D.
- Identify unsupported Nikon HE/HE* compression explicitly. The codec audit covers 65 of 72 public samples; the new float path was exercised on 63 passing CC0 captures plus a private A6700. Full-size Sony TIFF16 and two Nikon Z7 chart PNG16 exports passed; frozen chart means were 1.552104 / 1.434303 ΔE00 against publisher renderings, not physical or Adobe color certification. See [RAW compatibility](docs/RAW_COMPATIBILITY.md).
- Verify full-size ICC-tagged TIFF16 on X-Trans RAF, monochrome DNG, Sigma X3F, GoPro GPR, DJI DNG and 64.6 MP Light L16 DNG, independently of reduced codec checks.

## 0.9.7 — 2026-10-02

- Explicitly bundle the x64 WebView2 Loader at the installation root. The unpublished 0.9.6 installer candidate omitted it despite containing the Runtime bootstrapper.
- Installer preparation validates its resource map against an explicit four-file allowlist, including source locations and root destinations. Missing, nested, duplicate or unapproved resources fail before bundling.
- Recommended downloads are the complete Windows installer and portable ZIP. The installer provisions a missing Runtime with Microsoft's bootstrapper; the portable ZIP needs an existing Runtime.

## 0.9.6 — 2026-10-02 · Unreleased packaging candidate

- Windows GNU releases include the architecture-matched `WebView2Loader.dll` beside the executable. Installing WebView2 Runtime alone does not provide this application dependency.
- Release preparation rejects incomplete or mismatched native files and unexpected non-system DLL imports. It creates a portable ZIP from an explicit six-file allowlist, excluding build history, credentials and caches.
- SHA-256 checksums cover the loader, executable, license, notices, usage instructions and ZIP. Users must extract the complete package before running the app.
- Added a current-user Windows installer with a Microsoft WebView2 bootstrapper. It detects an existing Runtime and provisions a missing one with internet access. Installation includes the application DLL and license notices; the portable package requires an existing Runtime.
- Download guidance now points to complete packages rather than an incomplete standalone executable.

## 0.9.5 — 2026-10-01

- AI connection labels now derive from configuration and installed Agent availability. Preset model names no longer appear as an active connection without a stored API key. API configuration is distinguished from a verified connection; default Agent models remain client-selected.
- Sending, Enter and quick actions share a fresh readiness check. Disconnected drafts and submission failures retain input; provider changes during a check cannot send through a stale selection. Key changes notify the panel.
- The assistant uses a compact graphite/silver dock, flat run rows, wrapping prompts, icon controls and a fixed composer. Scrolling back through history is respected; entry and running motion obey appearance settings.
- Settings label presets as model services and the selected entry as the current selection.

## 0.9.4 — 2026-10-01

### Changed

- Added versioned whole-document, regional and original-resolution observations through the existing renderer, with original-coordinate evidence and bounded transient images.
- Connected actual image payloads to API providers, compatible local agents and MCP, including request limits, task-owned native attachments and cancellation cleanup.
- Added discoverable operation guides, task-specific tool groups, model/tool/image budgets, current-source guards and independent before/after review in the existing runtime.
- Kept tool success, actual document-state verification and aesthetic judgement distinct; incomplete evidence, unavailable vision and exhausted budgets retain explicit pending results.
- Added photography/layout briefs, explicit user taste preferences, bounded reference images and two isolated rendered candidate directions with canonical replay and one-task undo.
- Made candidate acceptance active and cancellable, preserved technical failures independently of user aesthetic choice, and included reference pixels/provenance in independent review under the original task budget.

Live model perception, external-client end-to-end operation and physical chart calibration remain separate verification limits. See [0.9.4 release notes](docs/releases/v0.9.4.md).

## 0.9.3 — 2026-09-30

### Changed

- Unified workbench, settings and secondary surfaces around graphite gray and silver controls, with consistent hover/press feedback and reduced/off motion modes.
- Added a recursive, keyboard-accessible layer tree, adjacent deep duplication, inherited locking, canvas alignment and center-preserving flips through shared UI/AI operations.
- Made nested geometry and pixel tools honor ancestor transforms and locks, with stale asynchronous asset commits rejected before document mutation.
- Added precise numeric and keyboard curve editing, pointer capture and cancellable continuous edits with one undo entry per gesture.
- Added selective RAW settings copy/paste with atomic undo and target-camera white balance handling, exposed through the existing canonical AI and MCP tools.

Physical chart calibration and live Agent chat remain separate verification limits. See [0.9.3 release notes](docs/releases/v0.9.3.md).

## 0.9.2 — 2026-09-29

### Changed

- Improved RAW automatic tone adjustment with scene-adaptive exposure, bounded tonal controls and rendered RGB highlight checks; placed white balance only in Color while keeping it searchable.
- Reused the image editor's preview surface and cached unchanged RAW comparison previews to reduce repeated allocations and rendering during interaction.
- Added built-in chat connections to installed Codex, Claude Code and Antigravity clients, preserving API providers and the canonical permission, command and undo path. Recent completed chat turns now follow the active document into subsequent requests.
- Clarified that Agent linkage via MCP is the external-control direction, separate from the app's local-agent chat connection.
- Stop stale agent edits after document switches or manual changes, recognize Windows npm CLI installations, and terminate local-agent child processes on cancellation, timeout or excessive output.

### Fixed

- Corrected image-editor zoom labels and the 100% action to use actual image-to-CSS display scale, including high-DPI displays and large photos; verified exact color sampling at 100% and 120% and reopening saved image and RAW projects on the release build.

### Verification limits

- Local Agent connections retain the client's model/provider configuration and authentication method. Legacy clients without the required sandbox and structured headless interface are rejected; compatibility depends on the installed CLI.
- Physical chart calibration and cross-camera consistency remain open; no new color-accuracy claim is made.

See [0.9.2 release notes](docs/releases/v0.9.2.md).

## 0.9.1 — 2026-09-29

### Changed

- Adopted the selected deep-gray silver `L + s` icon across the app and Windows assets; aligned Appearance settings with the current workbench and preserved preference migration.
- Added editable Smart Object Gaussian blur, unsharp sharpening and edge-preserving denoise filters, including ordered evaluation, project persistence, undo and canonical AI/MCP tools.
- Reorganized public documentation, added the branded README and architecture guide, consolidated cleanup scripts, and added GitHub issue templates and repository hygiene checks.
- Removed obsolete design variants, internal planning notes, duplicate reports and regenerable workspace products while retaining licenses, test fixtures and measurement evidence.
- Integrated the Windows caption into the compact application toolbar, with native drag, double-click maximize/restore, minimize and close controls. Close uses the existing unsaved-document guard.
- Unified secondary settings, AI, cutout and dialog surfaces with the neutral editor palette, consistent icons and restrained button feedback; preserve image pixels and meaningful color controls.
- Kept compact workspace navigation accessible through labels, hints and focus, including the minimum-width layout.
- Added native caption lifecycle tests and extended actual WebView layout checks to include the integrated toolbar and settings focus restoration.

### Fixed

- Isolated AI task history from concurrent manual edits, blocked unsafe older-task rollback, and checked cancellation after asynchronous tools complete.
- Restored external permission settings before accepting MCP requests; replaced the public default token with private random tokens and validated local HTTP origins and request limits.
- Corrected adjustment-layer opacity and masks, Smart Object rasterization, and premultiplied-alpha Smart Filter blending; unsupported non-raster conversions now fail before modifying a project.
- Protected current RAW resources, camera metadata and user snapshots during asynchronous decode updates and transaction undo/redo.
- Added optical small-icon variants and placed a 64-pixel image first in the Windows ICO so the runtime window icon no longer upscales a 16-pixel source.
- Recognize saved `.lsq` and `.lumiseq` projects in the persisted recent-project list, alongside legacy `.aistudio` and PSD files.
- Resolve the recent-project path from the native user data directory before loading, and share one initialization across concurrent readers.

See [0.9.1 release notes](docs/releases/v0.9.1.md).

## 0.9.0 — 2026-09-29

### Changed

- Unified the desktop workbench around neutral fixed panels, direct Home file actions, grouped Develop tools and cross-group search.
- Added view-only neutral color assessment, preview endpoint warnings and RGB/D50 Lab sampling of overview, native detail and comparison images.
- Preserved Develop zoom and tool search when returning through other workspaces, protected group keyboard navigation from parameter nudges, and improved the minimum-height layout.
- Tagged native PNG16 with standard sRGB metadata and native JPEG8 with an original MIT sRGB ICC profile; export UI describes actual precision and encoding.
- Added a second CC0 chart-render comparison with documented ICC conversion and no color fitting; retained camera/profile/display accuracy limits.
- Set the normal Tauri development binary explicitly and kept verification probes opt-in.

See [0.9.0 release notes and limitations](docs/releases/v0.9.0.md).

## 0.8.0 — 2026-09-29

### Changed

- Replaced regional dehaze with whole-source RGB atmospheric estimation, dark-channel analysis and fast guided-filter coefficients shared by overview, detail crops and native export.
- Replaced small blur denoise with three B3 spline wavelet levels, separate luminance/chroma shrinkage and noise estimated from native-resolution patches. Native stripes include full wavelet and downstream detail support.
- Disabled LibRaw's implicit histogram brightening. Exposure zero now preserves decoded exposure/headroom; existing RAW renditions can appear darker than 0.7.3 when reopened. The public Nikon chart regression reproduced clipping before the fix and preserves its white patch afterward.
- Kept Develop sliders, saved parameters, AI/MCP operation services and editor structure. Processing quality changes may change existing recipes' appearance.
- Added a dependency-free PNG8/16 color-chart measurement CLI with explicit reference provenance, D50 adaptation, CIEDE2000 and clipping reports; public CC0 chart RAW and publisher TIFF comparisons are documented separately from physical calibration.
- Added opt-in Tauri WebView verification for real production GPU filters; this development probe is excluded from ordinary release builds.

### Validation

See [0.8.0 release notes and limits](docs/releases/v0.8.0.md). Camera-specific ICC/DCP and absolute chart accuracy still require measured chart references and controlled capture conditions.

## 0.7.3 — 2026-09-29

### Changed

- Full-resolution RAW export applies texture, clarity, regional dehaze, sharpening, and luminance/chroma denoise, using the same parameters and stage order as WebGL. Float processing uses stripes with neighboring pixels; source radii follow overview scale, and detail previews include padding before cropping.
- Automatic white balance analyzes unedited source samples once and persists a versioned correction shared by UI, AI/MCP, history, saved projects, preview and export. Insufficient neutral candidates retain as-shot colors; unresolved legacy auto settings still block export.
- Camera WB is initialized before LibRaw opens the file. The build compiles the current C++ wrapper instead of linking a stale wrapper archive.
- Native export borrows the original asset during rendering, avoiding a full source clone, and validates dimensions/format before allocating. Overlapping WB requests no longer corrupt the progress/error state.

### Validation limits

- Spatial filters remain local approximations: no ISO-specific sensor noise profiles, multiscale wavelets, or global atmospheric-light estimate. Auto WB is a conservative postdecode correction.
- Color-chart accuracy and ICC/DCP profiling remain unverified in this version. Details: [0.7.3](docs/releases/v0.7.3.md).

## 0.7.2 — 2026-09-29

### Changed

- Native full-resolution RAW export now applies whites, blacks, vibrance, eight-channel HSL, tone curves, and vignette using the existing preview settings and pipeline order.
- The color controls continue through the existing UI and AI/MCP operation path. Spatial adjustments and unresolved auto white balance still produce explicit export errors.
- Native export validates curve and HSL payloads before accessing image data.

### Validation limits

- Synthetic 16-bit pixel tests cover the added adjustments, local masks, PNG precision, JPEG quality, and resize behavior. Representative camera RAW and color-chart comparisons remain pending.

## 0.7.1 — 2026-09-28

### Changed

- Open documents remain visible as tabs when switching between Home, Edit, and Develop. Each workspace restores its last open document; visited workspace components retain local UI state.
- Automatic cutout is available in the contextual selection toolbar and starts recognition when opened. Subject recognition and edge refinement share one workflow.
- Cutout inference crops transparent document margins and restores the mask in document coordinates. Color-aware connectivity repair bridges missed subject regions with contrasting backgrounds.
- The eyedropper samples the composited document at native pixel resolution across display scaling, zoom and pan, without selection or checkerboard overlays. Centered averaging windows are clipped at image edges and account for alpha coverage.
- The color dialog retains HSL calculation precision, accepts three- and six-digit HEX input, and blocks incomplete values. AI color sampling now returns actual document pixels instead of a white placeholder.
- Automatic cutout uses a preview-first workbench: fitted image preview, original/result/mask views, grouped brush and edge controls, and fixed footer actions. View mode prevents accidental strokes; zoomed previews can be dragged to inspect edges.
- Windows build helpers resolve the current checkout and MinGW tools instead of relying on one developer's paths.
- The Rust unit-test harness now embeds the same Common Controls v6 manifest as the desktop app, allowing native dialog dependencies to load during tests.
- The move tool snaps layer edges and centers to the canvas and other visible layers, shows transient alignment guides, and supports a toolbar toggle or Alt bypass. Locked layers cannot start a move gesture.
- Zoom-tool clicks and Ctrl+wheel zoom retain the document point beneath the pointer. The existing AI/MCP transform operation remains the exact-position interface.

### Repository

- Original Lumiseq code is released under MIT. Third-party components keep their original licenses.
- Executables, local build history, model weights, caches, and agent scratch files are excluded from Git.
- Added an explicit command to retrieve and verify the pinned model, source CI, contribution notes, and a GitHub release guide.
- Updated Vitest to 4.1.11 to resolve the dependency advisory reported by `npm audit`.

### Validation limits

- Workspace restoration and mask connectivity have automated regression coverage.
- Full desktop interaction verification of this release is incomplete.
- Complex cutout edges may need manual refinement; algorithmic regression coverage does not guarantee quality on every image.
- Live provider tests require external service credentials and are excluded from ordinary CI.
- Automated geometry tests cover pointer anchoring, guide position, lock behavior and Alt bypass.

## 0.7.0

Existing Windows desktop baseline: layered editing, native projects and PSD compatibility, RAW development, local cutout, provider settings, and MCP support. Local validation reports are excluded from the public source repository.
