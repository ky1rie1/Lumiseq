# Layered editor precision

The development source adds an explicit Float32 editor. Published 0.9.7 installers still use their earlier implementation until a new public release is made.

## Source, Working and Delivery Precision

| Stage | Contract |
| --- | --- |
| Original asset | Immutable original encoded bytes; JPEG, PNG, TIFF, WebP and BMP are decoded natively |
| Source color | Embedded ICC converted to extended linear sRGB; untagged integer RGB defaults to sRGB, proven untagged TIFF32F defaults to linear sRGB |
| Working document | `renderingVersion:2`, `bitDepth:32`, `workingProfile:'linear-srgb'`; straight alpha and signed/HDR channels |
| Display / AI image evidence | Final sRGB display conversion, 8-bit; this is not a high-bit-depth source |
| PNG / TIFF delivery | 16-bit with unassociated alpha and selected sRGB / Display P3 ICC |
| JPEG delivery | 8-bit with selected ICC; transparent content is composited onto white |
| Diagnostic TIFF32F | Signed linear output with linear ICC; explicit native diagnostic, not a normal UI format |

An 8-bit input remains an 8-bit original even when calculations use Float32. Converting it does not recover discarded colors. Malformed or unsupported profiles fail explicitly. EXIF orientation is applied; associated TIFF alpha is decoded to straight alpha before calculations. Browser Canvas is used for font/brush raster sources and final display, not to decode a high-bit-depth original or flatten the working master.

## Processing Order

Exposure and offset are linear-light operations. Curves use continuous shape-preserving interpolation rather than an 8-bit LUT. Artistic color adjustments and blend modes have explicit extended encoded domains; normal light composition remains linear. Gaussian blur is normalized and premultiplied-alpha aware; sequential luminance sharpening and edge-aware denoise retain float working values and source boundaries. These independently implemented algorithms do not claim identical Photoshop slider responses.

Layers, isolated groups, clipping foundations, transforms, generated patches and masks are evaluated in document coordinates. Filter and mask halos precede cropping. Nonlinear adjustment and blending happen on the original grid before final resampling. A single full-frame RAW source can reuse native developed pixels directly; multi-layer adjustments still require final composite resampling. Bounded source tiles avoid a full camera-sized JavaScript Float32 plane.

RAW smart objects embed the original RAW bytes and editable Develop recipe. Opening parameters creates a linked Develop variant; applying it changes the recipe through one undoable command. A frozen raster export is a different operation. Old documents keep their original renderer; `edit_upgrade_precision` creates a separate explicit 32F copy, whose appearance can differ because its mathematics changed.

Linked parameter variants use temporary native staging files. Apply their parameters and save the original image project; they cannot be saved as a standalone path-only Develop project whose temporary source would disappear on close. Ordinary Develop projects continue referencing their camera file.

## Projects and Limits

Version-2 `.lsq` uses an `LSQ2` binary envelope: bounded UTF-8 manifest plus original binary blobs. Resource offsets, dimensions, references and SHA-256 are verified before registration. The format embeds source files, exact mask bytes and recipes; derived float caches are rebuilt. Legacy JSON projects remain readable. Recovery retains one immutable RAW source and exact saved masks instead of rereading a mutable camera file or reconstructing its mask from geometry.

- Project manifest: 4 MiB; at most 4,096 resources.
- Project source: 512 MiB per resource; 1 GiB total binary payload.
- Generic native decode: 64 million pixels and a 1 GiB decoded-source registry budget. Encoded input and decode scratch require additional memory.
- RAW staging: 256 MiB per source; decoding keeps the existing native camera-memory bounds.
- LF32 request: at most 4,096 per dimension and six million pixels; normal renderer source tiles are 256 square.
- Delivery: at most 150 million pixels; complete ordered bands are uploaded to an atomic native export session.

Oversized inputs fail explicitly. Closing the last document reference releases decoded leases, including native ready Develop handles; immutable original blobs may remain needed by undo history. Initial RAW loading stages the captured original bytes and cleans the temporary path after decoding or cancellation. Native RAW recipe stripes have a 128 MiB / 16-record bound and are invalidated by source release. No decoded float cache is written into the project.

The current PSD writer supports an 8-bit contract. It rejects version-2 documents rather than silently reducing them. Save `.lsq` for editable high-precision state or export PNG16 / TIFF16 for delivery. Existing paint/retouch/gradient raster sources are 8-bit drawing assets; this does not reduce underlying original-image or RAW precision.

## AI and Verification

`edit_auto_color` exposes separate Auto Contrast, Auto Tone and Auto Color strategies as adjustment layers, with one undo, immutable source, version checks and numerical fallback. `edit_raw_smart_object` and `edit_upgrade_precision` reuse document operations and history. Optional RAW semantic candidates require a current overview followed by native-resolution ROIs and are compared with local/neutral recipes before committing. Read the shared [AI operation guide](../MCP.md).

Numerical fixtures test exposure reversal through HDR values, adjacent 16-bit gradients, monotonic curves, normalized Gaussian impulses, alpha, groups, linked masks, clipping and final-resize order. Opt-in `integration/float-editor-validation.html` runs production binary IPC, rendering, project persistence, export and RAW/Worker services in the actual WebView2 quality probe. Reports and camera originals stay outside the repository.

The 2026-10-03 actual WebView2 run passed 15 checks with a private 6192×4128 Sony capture. PNG16 and TIFF16 retained eight adjacent source codes, with zero decoded working-pixel difference after one export. A signed/HDR +1 then -1 exposure fixture recovered its original values and alpha. Original-grid gamma followed by a 2×1 to 1×1 resize yielded linear 0.5 and display code 188, rather than averaging encoded colors. RAW smart-object binary reopening preserved all 32,256,000 original bytes; recipe application and reopening each matched a native 128×128 corner tile with zero float error.

To reproduce with local camera input, start `npm run dev -- --host 127.0.0.1`, then run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-float-editor.ps1 -RawPath <absolute-camera-path>`. The script builds the opt-in native probe, requires a fresh passing report and keeps generated evidence in `%LOCALAPPDATA%/AI-Creative-Studio/float-editor-validation`. Without `-RawPath`, camera checks are explicitly skipped. Native regression tests also verify three successive PNG16/TIFF16 round trips of adjacent codes and sampled ICC curve precision independently of the browser.

Non-destructive means preserving original bytes and replayable parameters. Demosaicing, filtering, resampling, floating-point rounding and JPEG delivery are not mathematically lossless. Physical camera calibration, monitor calibration, soft proofing and exact Adobe equivalence remain separate quality requirements.
