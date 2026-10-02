# Development guide

## Requirements

| Tool | Requirement |
| --- | --- |
| OS | Windows x64, WebView2 runtime |
| Node.js | 22.12 or newer; use the locked npm dependencies |
| Rust | 1.85 or newer, Windows GNU toolchain |
| Native compiler | MinGW GCC 13+, including `g++` and `windres.exe` |
| Shell | Windows PowerShell 5.1 or PowerShell 7+ |

The native LibRaw library in this repository targets the Windows GNU toolchain. Source, headers, notices, and its required static library are retained together.

## First run

```powershell
npm ci
npm run model:download
. .\scripts\dev-env.ps1
npm run tauri:dev
```

`model:download` explicitly retrieves the pinned BiRefNet weights and validates file size and SHA-256. Model weights are ignored by Git. Normal builds validate the model and can reuse the known local verified cache; they do not download it silently.

Put MinGW `g++` and `windres.exe` in PATH. If discovery fails, configure `LUMISEQ_MINGW_LIB_DIR` and `LUMISEQ_REAL_WINDRES` for your toolchain. The resource helper is built from `src-tauri/bin/windres.rs`.

`dev-env.ps1` uses `%LOCALAPPDATA%\AI-Creative-Studio\cargo-target` for Cargo output. Dot-source it in each development shell to keep large Rust caches outside the checkout.

## Checks

```powershell
npm run typecheck
npm test
npm run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-cargo.ps1 test
```

`npm run dev` serves the desktop UI for inspection. Native dialogs, RAW decoding, DPAPI, file persistence, and clipboard operations require the Tauri host.

Module tests live beside source; broader tests live in `tests/`. Production WebGL and real-file harnesses live in `integration/`. Tests needing credentials or private RAW files are opt-in; see [RAW fixtures](../tests/raw-fixtures/README.md).

## Release build

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-release.ps1 -Publish
npm run release:prepare
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-installer.ps1
```

The build helper rebuilds the app crate, uses the Tauri CLI and external Cargo cache, checks native imports and the Windows GUI PE subsystem, and copies `lumiseq.exe` with its matching x64 `WebView2Loader.dll` to `artifacts/windows/`. Release preparation rejects incomplete packages, checks the embedded version, writes notices/checksums, and builds a portable ZIP from an explicit public-file allowlist. Runtime installation does not provide the application's loader DLL.

Use the Tauri release path so the frontend is embedded with the correct custom protocol. Plain `cargo build --release` does not establish a standalone packaged desktop app.

`package-installer.ps1` verifies the staged EXE/Loader against the native build, uses `src-tauri/tauri.release.conf.json` to create an NSIS installer, and refreshes final checksums. The release-only overlay embeds Microsoft's WebView2 bootstrapper, installs for the current user, and includes only explicitly listed license/instruction resources. Provisioning an absent Runtime needs internet; the full offline Runtime is not bundled.

The resource map explicitly places the GNU build's Loader at the installation root. The pre-bundle gate requires this mapping and validates the four approved sources and destinations; a working portable package alone does not prove the installer includes its DLL.

Tauri stamps installer-type metadata into the executable bundled by NSIS. The script restores the original portable input afterward, so installed and portable EXE hashes can differ while their application version and source match.

## Brand assets

```powershell
npm run brand:generate
```

Editable geometry lives in `scripts/brand/`. The generator writes the canonical SVG mark, PNG/ICO application icons, README cover and light/dark architecture diagrams. `readme.mjs` owns the cover's outlined lettering and documentation layout; it does not change the application icon. Both README languages share these assets. The accepted deep-gray silver `L+s` design is the source for all generated assets.

README lettering uses Manrope and Caveat as SVG outlines, so GitHub does not need to load fonts. The checked-in glyph data in `scripts/brand/readme-type.mjs` is sufficient for normal asset generation. To regenerate that data, download `Manrope[wght].ttf` and `Caveat[wght].ttf` from Google Fonts revision `9710da1eacb3be272583c3224dcb70f9da6eadbb` (`ofl/manrope/` and `ofl/caveat/`), rename them to `Manrope.ttf` and `Caveat.ttf`, and place them in the ignored `reference-source/fonts/` directory. Then run:

```powershell
python -m pip install fonttools==4.61.1
python scripts/generate-readme-lettering.py reference-source/fonts
npm run brand:generate
```

The script checks both font files against pinned SHA-256 hashes. Keep the [Manrope](../licenses/OFL-Manrope.txt) and [Caveat](../licenses/OFL-Caveat.txt) license texts with the generated outlines.

## Workspace cleanup

```powershell
npm run clean
npm run clean -- -ReleaseArtifacts
npm run clean -- -Models
npm run clean -- -Dependencies
```

The default removes local build output, generated tests, verification scratch data, schemas, and TypeScript cache. Release programs, downloaded weights, and npm dependencies require the corresponding explicit switches. Close local build and test processes before cleaning.

The cleaner is restricted to known paths inside the checkout. External Cargo caches and application data are managed separately.

## Publishing and repository checks

```powershell
npm run repo:check
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-project-size.ps1
```

Repository checks validate documentation links and reject accidental tracked build output or model weights. See [GitHub release guide](GITHUB_RELEASE.md) for the first push and release assets.
