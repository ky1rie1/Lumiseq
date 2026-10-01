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
```

The build helper rebuilds the app crate, uses the Tauri CLI and external Cargo cache, verifies the Windows GUI PE subsystem, and copies `lumiseq.exe` to `artifacts/windows/`. Release preparation checks the embedded version and writes dependency notices and SHA-256 checksums.

Use the Tauri release path so the frontend is embedded with the correct custom protocol. Plain `cargo build --release` does not establish a standalone packaged desktop app.

## Brand assets

```powershell
npm run brand:generate
```

Editable geometry lives in `scripts/brand/`. The generator writes the canonical SVG mark, PNG/ICO application icons, README cover and light/dark architecture diagrams. `readme.mjs` owns the cover's outlined lettering and documentation layout; it does not change the application icon. Both README languages share these assets. The accepted deep-gray silver `L+s` design is the source for all generated assets.

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
