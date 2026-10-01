# Contributing to Lumiseq

Start with the [development guide](docs/DEVELOPMENT.md) and [architecture map](docs/ARCHITECTURE.md).

## Make a change

1. Describe the workflow and the expected result.
2. Keep document mutations in the command and operation-service path.
3. Add regression coverage where behavior, persistence, coordinates, or pixel calculations change.
4. For new editor capabilities, expose the corresponding canonical AI tool and MCP mapping.
5. Run the relevant checks and record actual desktop workflows tested.

```powershell
npm run typecheck
npm test
npm run repo:check
npm run build
```

For native changes, also run `scripts/run-cargo.ps1 test` and inspect the packaged desktop app. Tests requiring service credentials or camera media remain opt-in.

## Pull requests

Explain what changed, why, how it was checked, and remaining limits. Keep unrelated formatting or refactors separate. Include screenshots for visible changes and reproducible samples for pixel-processing changes.

Preserve the neutral UI system, reduced-motion behavior, keyboard access, undo semantics, and existing project compatibility.

## Bug reports

Include version, Windows environment, reproduction steps, expected/actual results, and a minimal example you may share. Cutout reports are most useful with both the original and resulting mask. RAW/color reports should name the camera, output format, and reference used.

## Repository hygiene

Keep personal photos, projects, credentials, models, binaries, caches, and generated test output out of source commits. Use `npm run repo:check` to check documentation links and tracked artifacts.

Original contributions are submitted under [MIT](LICENSE). Third-party code and assets require compatible licenses and preserved upstream notices. See [third-party notices](THIRD_PARTY_NOTICES.md) and [security guidance](SECURITY.md).
