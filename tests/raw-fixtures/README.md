# RAW Validation Fixtures

Use your own camera RAW to compare native full-resolution output, production GPU previews and automatic white balance. Private media, generated reports and validation history are excluded from Git. Pipeline limits are described in [release notes](../../docs/releases/v0.7.3.md).

## Repeatable Spatial and White-Balance Checks

Set these environment variables to your own RAW file and an ignored output directory:

```powershell
$env:LUMISEQ_RAW_VALIDATION = 'absolute path to your camera RAW'
$env:LUMISEQ_RAW_REPORT_DIR = Join-Path (Get-Location) 'generated-test-output\raw-spatial'
& .\scripts\run-cargo.ps1 test --lib --release real_camera_raw_spatial_export_validation '--' --ignored --nocapture
npx vitest run integration/real-raw-validation.test.ts
$env:LUMISEQ_RAW_AUTO_RESULT = Join-Path $env:LUMISEQ_RAW_REPORT_DIR 'resolved-auto.json'
& .\scripts\run-cargo.ps1 test --lib --release real_camera_raw_spatial_export_validation '--' --ignored --nocapture
```

The first native run checks eight full-resolution 16-bit PNG outputs and writes a native linear sample grid. The frontend test runs the production white-balance estimator and persists its result; the second native run checks that matrix's PNG/JPEG output.

`integration/real-raw-gpu-validation.html` compares the production engine with native crops using local generated files. `integration/raw-spatial-validation.html` compares float GLSL with independent synthetic CPU results. These checks do not establish physical chart calibration or model visual understanding.

## Source Policy

Public model/compression fixtures are described in [RAW compatibility](../../docs/RAW_COMPATIBILITY.md). `camera-corpus.json` stores public metadata and expected decoding status only. `scripts/prepare-raw-corpus.ps1` verifies hashes, stores camera files outside the checkout, and excludes noncommercial research references from automatic downloads.

Large camera RAW files, private photographs, local paths and generated image/report outputs must not enter the public repository. Use local files or public samples with explicit redistribution licenses. Generated outputs stay in ignored directories.

## Synthetic Fixtures

- `tests/fixtures/sample.dng` is a container/routing fixture for extension validation, UI routing and mock-platform tests. It is not a real sensor-decode fixture.
- `tests/fixtures/sample_raw_metadata.json` contains mock metadata for frontend bridge tests.
- The tiny JPG/PNG fixtures support routing and image-container tests; they are not user photographs.
