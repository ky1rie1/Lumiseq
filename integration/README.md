# Integration checks

These harnesses exercise production GPU rendering, camera RAW output, workbench layout and optional live providers. They complement the ordinary unit suite and require their respective runtime or sample data.

| Harness | Purpose |
| --- | --- |
| `gpu-validation.html` | Production WebGL color path |
| `raw-spatial-validation.html` | Synthetic GPU/CPU spatial and white-balance comparison |
| `real-raw-validation.test.ts` | Opt-in real-file white-balance validation |
| `real-raw-gpu-validation.html` | Native crop / production preview comparison |
| `spatial-quality-validation.html` | Dehaze and denoise quality checks |
| `workbench-validation.html` | Workbench fixture and interaction assertions |
| `layer-workflow-validation.html` | Production editor fixture with recursive groups and reference pixels |
| `develop-workflow-validation.html` | Two original raster documents for curve/history and selective settings transfer |
| `ai-harness-validation.html` | Original 24 MP image through the production document observer; overview coverage, exact ROI mapping and native pixel details |
| `cutout-validation.html` | Local cutout inference validation |
| `live/` | Opt-in credentialed provider checks |

The native `spatial-quality-probe` target is enabled with the `quality-probe` feature and is excluded from normal app builds. Start Vite before running browser harnesses. Refer to [RAW fixture instructions](../tests/raw-fixtures/README.md) for actual camera validation. Keep generated media and credentials outside tracked source.

The workbench and layer fixtures generate original 640 × 480 color blocks in the browser, so they need no camera file or downloaded sample. The layer fixture is interactive; its read-only document report supports inspection of UI operations. Save/reopen and native RAW export still require desktop verification.

The develop workflow fixture uses the same generated color blocks and production DevelopWorkspace. Its source has exposure +1.25, contrast +12 and a three-point identity RGB curve. The target starts at exposure zero with its own custom white balance. The offscreen JSON report exposes document settings and command history for read-only inspection; it does not emulate camera decoding or native file operations.

The AI observation fixture makes its own 6000 × 4000 input, including known colors, a 12 px label and a 2 px edge. No live provider request occurs. Typecheck its additional entry points with `npx tsc --noEmit --project integration/tsconfig.ai-harness.json`. The optional `?runtime=1` check uses synthetic model replies with the production renderer, canonical tools and real command bus to exercise precise/visual edits, mixed layout requests containing dimensions, actual image attachments, task undo, persisted-history privacy and blocked visual uploads. A throwing legacy canvas inspector detects any regression to viewport-based observation. Synthetic review replies test orchestration and do not establish model comprehension. The optional `?raw=1` check needs local opt-in native `combined` RAW reports in `generated-test-output/ai-harness/raw-camera/`; it compares a production WebGL observation against a full-size native export crop using locally decoded native tiles. This optional check does not assert live Tauri IPC or chart calibration. Reports and private media stay ignored. See [AI observation and verification](../docs/ARCHITECTURE.md) for the implementation boundaries.

The optional `?creative=1` check renders two isolated candidates using the same production engine, checks their actual pixels and unchanged source, replays the selected canonical operations with symbolic new layer IDs, serializes/reopens the resulting project, and undoes the whole task. It uses original generated media and literal `$10` text to exercise ordinary currency strings independently from ID references. This is a service and persistence integration check; interactive candidate controls are checked separately.

`ai-harness-creative-ui.html` mounts production `CreativeReview` and `TasteSettings` controls with an original 1200 × 800 geometric image. Candidate selection calls the real service and command bus; the task undo button checks the same history path. Preferences use an isolated memory store so interface checks do not change the user's saved tastes. Read the visible document report to verify layer/selection/history state after clicks.
