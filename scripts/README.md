# Development scripts

| Script / command | Purpose |
| --- | --- |
| `dev-env.ps1` | Configure an external Cargo target directory |
| `run-cargo.ps1` | Run Cargo with the configured Windows build environment |
| `build-release.ps1 -Publish` | Build, verify and copy the desktop release |
| `npm run release:prepare` | Verify dependencies, generate notices/checksums and a complete portable ZIP |
| `windows-release.mjs` | Validate x64 PE imports and stage EXE with its WebView2 loader |
| `package-portable.ps1` | Archive only the explicit public release files |
| `package-installer.ps1` | Bundle the verified native build with WebView2 provisioning and refresh checksums |
| `windows-clean-acceptance.ps1` | Verify public release downloads and Runtime provisioning on a disposable GitHub-hosted VM; local/self-hosted execution is rejected |
| `windows-home-probe.mjs` | Check rendered home-page readiness inside the disposable acceptance VM |
| `npm run model:download` | Download and verify the pinned cutout weights |
| `npm run brand:generate` | Generate icons and README banner from `brand/` |
| `npm run repo:check` | Check local documentation links and tracked outputs |
| `npm run clean` | Remove regenerable output; extra switches opt into models, releases or dependencies |
| `check-project-size.ps1` | Report source, dependencies, native libraries and local caches |
| `validate-chart-color.mjs` | Measure PNG color patches against explicit references |
| `validate-float-editor.ps1 [-RawPath <camera-file>]` | Opt-in production WebView2 float transport, rendering, binary project and export checks; start Vite on port 5173 first. Reports stay outside the repository |
| `validate-desktop-build.mjs <port> <commit>` | Read-only local package readiness and exact clean-source identity check; launch the package with a loopback WebView2 debug port first |
| `mcp-external-smoke-test.cjs` | Opt-in smoke checks against a running authenticated MCP host |

See [development](../docs/DEVELOPMENT.md), [releases](../docs/GITHUB_RELEASE.md), and [color measurement](../docs/technical/COLOR_MEASUREMENT.md).
