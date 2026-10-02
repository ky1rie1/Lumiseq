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
| `npm run model:download` | Download and verify the pinned cutout weights |
| `npm run brand:generate` | Generate icons and README banner from `brand/` |
| `npm run repo:check` | Check local documentation links and tracked outputs |
| `npm run clean` | Remove regenerable output; extra switches opt into models, releases or dependencies |
| `check-project-size.ps1` | Report source, dependencies, native libraries and local caches |
| `validate-chart-color.mjs` | Measure PNG color patches against explicit references |
| `mcp-external-smoke-test.cjs` | Opt-in smoke checks against a running authenticated MCP host |

See [development](../docs/DEVELOPMENT.md), [releases](../docs/GITHUB_RELEASE.md), and [color measurement](../docs/technical/COLOR_MEASUREMENT.md).
