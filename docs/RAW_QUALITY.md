# RAW processing and quality

The development candidate retains the existing UI, commands and AI architecture. Published 0.9.7 binaries use the earlier pipeline. The 2026-10-03 changes below are source changes awaiting a new public release.

## Working pipeline

```text
Immutable camera RAW
  → LibRaw black subtraction and integer camera-space demosaic
  → camera active crop and metadata-calibrated Sony lens mapping
  → float camera white balance and RGB matrix
  → extended linear sRGB RGBA32F master
  → bounded LF32 overview / exact source-coordinate detail / AI observations
  → float adjustment stages
  → selected output profile and final delivery quantization
```

New imports use high-quality demosaic and processing version 2. Saved legacy projects retain version 1 so their framing and coordinates do not silently change. The full master stays native; transport is capped at a 2048-pixel overview edge and six million pixels per detail request. No full master clone is made for preview or analysis. GPU buffers use RGBA32F after verifying actual float readback and filtering; otherwise rendering falls back to the CPU.

The lens section can create a separate uncorrected inspection or corrected version-2 document. Both retain float camera calibration and the active area; the inspection mode skips distortion, aberration and shading tables. The original project stays intact. Undo closes the variant, and redo rebuilds its pixels rather than restoring released resources. Local masks prevent this operation because their coordinates cannot safely migrate across a different lens mapping. Mode and calibration provenance are serialized and exposed through the same canonical AI/MCP tool, `develop_create_raw_variant`.

The 2026-10-02 desktop acceptance covered import, +1.70/+4 EV, 100% navigation, saved-project reopening and full-size TIFF16/P3 export. That candidate also passed visible uncorrected-variant creation, undo back to the corrected original, and fresh decoding after redo. The 2026-10-03 context menus and update panel passed browser interaction checks; current tone/detail passed actual native WebView2 and full-size file checks. A complete manual desktop walkthrough of the new candidate remains separate from these tests.

Signed values and values above one remain valid working colors. Constant signed/HDR denoise and detail tests guard against accidental clipping. The original sensor file remains the authority for reprocessing. LibRaw's black subtraction and demosaic still use integer samples; this implementation does not claim mathematically lossless sensor processing or recovery of saturated sensor data. Floating sensor DNG is rejected explicitly until a float sensor decoder is available.

## Automatic tone and rendering versions

`rawProcessingVersion` controls sensor decoding and lens coordinates. Independent `settings.renderingVersion` controls tone and detail mathematics. Missing rendering versions mean legacy version 1, including when reopening or resetting an old project. New documents use version 2. The RAW context menu and `develop_upgrade_rendering` create an undoable separate version-2 document without changing decoder version or mask coordinates; its mask assets and native decoding are independent.

Version-2 automatic tone reads up to 65,536 native float RGB samples, comprising a spatial grid and up to 512 bright-tail samples. A full-source scan supplies peak/headroom/signed statistics without cloning the master. A bounded joint search evaluates six tone controls against production white balance, color, mask pixels and vignette. It preserves existing adjustment intent, commits once, and rejects source/settings changes, document switches and cancellation. Raster inputs honestly report an 8-bit display source; legacy documents keep the earlier automatic adjustment.

The objective uses scene-dependent luminance percentiles, channel clipping, bright tails and restrained parameter changes. These are heuristics, not semantic understanding or an Adobe automatic-tone implementation. Existing denoise, dehaze and spatial detail are not simulated inside the point optimizer: the returned evidence requires native-resolution visual inspection of the final render. Night photographs are kept low-key rather than forced toward a daylight target.

Version-2 texture/clarity use complete normalized Gaussian guided filtering of signed log luminance. Sharpening evaluates the current stage with a normalized Gaussian, smooth threshold/noise transitions and local controls on added halos. Isolated bright peaks receive less shape-changing enhancement. Working RGB is never clamped to a display range by these stages. Native stripes and regional GPU/CPU rendering include the summed filter support before cropping.

### Detail validation

Twenty-two actual WebView2 checks passed on an RTX 5070 Ti, including independently generated native fixtures. The worst CPU/GPU float error was 0.0000041; GPU/native errors were at most 0.0000036 on the HDR edge, 0.000000016 on the point fixture and 0.000000060 on HDR tone. Circular subpixel point fixtures had a minimum added dark halo of approximately -0.000586 and rotation error below 0.000000015. Separate fixtures verify that ordinary edge sharpening remains effective and negative texture actually smooths fine contrast. The legacy branch retains its existing edge result.

The private Sony A6700 was decoded to a 25,560,576-pixel float source; bounded sampling took 103 ms in the measured native run. Neutral and clarity 40 / sharpening 80 / radius 1.8 versions exported full-size PNG16 and eight original-coordinate point crops. Inspected crops retained source point structure without an added visible axial cross. This is bounded evidence on one scene, not validation of every star, lens, camera or slider combination.

The same source's automatic result was classified low-key, using +1.21 EV with contrast 12, highlights 40, shadows -45, whites 35 and blacks -35. Sampled linear median changed from 0.01105 to 0.01704 without sampled channel clipping. Auto plus clarity/sharpening exported 6192×4128 Display P3 TIFF16 in 32.8 seconds; the complete native test process peaked at 926 MiB working set, including decode and export. Strict independent Sharp/libtiff pixel reading and ICC conversion passed. These timings describe one measured run, not a cross-device performance guarantee.

## Sony corner correction

The private ILCE-6700 / E 18–135mm capture supplies an active crop and signed TIFF lens tables. A bounded structured parser reads distortion, red/blue aberration and shading parameters. One radial source mapping is applied before RGB conversion; positive distortion that would leave the sensor frame uses a conservative valid-field crop. Interpolation samples real camera pixels. No generated color or black-border fill is used.

The output is **6192×4128**, matching the supplied Camera Raw screenshot's frame dimensions. Full-size Display P3 TIFF16, overviews at 0/+1.70/+4 EV, and four 128×128 original-resolution corner regions were generated. The corrected overview no longer shows the previous large black corner shapes. The master retains 290 pixels with a channel above one, maximum 4.210332, and signed channels in 520,456 pixels. These counts describe this capture; negative values are not automatically a defect or usable sensor detail.

Actual WebView2 tests passed LF32 binary overview/tile transport, signed/headroom precision, orientation and corrected Sony corner exposure. GPU/CPU corner displays differed by at most one 8-bit channel code. Ten spatial quality cases also passed in the actual WebView. Neither result establishes bitwise full native-export equality.

## Delivery

| Format | Channels | Profile |
| --- | --- | --- |
| Native PNG / TIFF | 16-bit, opaque | Original matrix/TRC sRGB or Display P3 ICC |
| Native JPEG | 8-bit, opaque | Selected ICC |
| Diagnostic TIFF32F | Signed linear float, original dimensions only | Linear sRGB / Display P3 ICC |
| Image-editing Canvas | 8-bit | Existing browser delivery contract |

Independent decoders verify exported sample codes, dimensions and ICC tags. Original-size export clips and quantizes only at its delivery boundary. Resized native delivery currently uses Lanczos3 on encoded 16-bit output; it is not advertised as linear-light resampling. Display P3 tagging does not itself add monitor calibration, HDR presentation or soft proofing.

TIFF delivery and diagnostic TIFF32F explicitly identify the fourth channel as unassociated alpha through the standard `ExtraSamples` tag. This avoids strict-reader failures when an RGB TIFF has four samples; the delivered alpha is opaque.

Full-size native TIFF16 with embedded ICC also passed on these public sensor families, separately from the reduced-size codec matrix:

| Sample | Input | Full dimensions |
| --- | --- | --- |
| Fujifilm X-T2, X-Trans | RAF | 6032×4028 |
| Leica M Monochrom (Typ 246), monochrome | DNG | 5984×4000 |
| Sigma DP1, layered sensor | X3F | 2651×1767 |
| GoPro HERO7 Black | GPR | 4000×3000 |
| DJI FC4382 | DNG | 4032×3024 |
| Light L16, high resolution | DNG | 9280×6960 |

The Sony uncorrected float inspection also exported at 6192×4128, with no lens-table adjustments. These are real-file decode, precision, geometry and profile-output checks; they do not certify each camera's color rendering or lens correction. Only supported Sony embedded tables currently provide calibrated lens correction; other inputs explicitly report active-area-only provenance.

## Frozen color regression

Both verified CC0 Nikon Z7 captures were exported at **5520×8288, PNG16, as-shot WB, zero adjustments**. No color, exposure or ROI fitting was performed. The validator independently checks the embedded sRGB matrix/TRC before computing Lab. Reference manifests and publisher ICC-derived Lab values stayed fixed.

| Capture | Mean ΔE00 | P95 | Maximum | Clipped patches |
| --- | ---: | ---: | ---: | ---: |
| Outdoor Workshop | 1.552104 | 2.585749 | 2.764385 | 0/24 |
| Garden Nook holdout | 1.434303 | 2.183306 | 2.256972 | 0/24 |

These measure agreement with the publisher's RawTherapee rendition, covering two frames from one camera and nearby natural-light captures. They do not establish physical chart accuracy or PS/Camera Raw parity. Adobe Color, tone mapping and camera profiles are different rendering choices; matching slider numbers cannot establish an equivalent pipeline. A tagged, full-size Camera Raw reference and recorded processing version are still needed for a quantitative Adobe comparison.

## References and scope

- [Compatibility matrix and unsupported variants](RAW_COMPATIBILITY.md)
- [Frozen reference methodology and coverage limits](technical/COLOR_PARITY.md)
- [LibRaw API and processing parameters](https://www.libraw.org/docs/API-datastruct-eng.html)
- [RawTherapee lens workflow](https://rawpedia.rawtherapee.com/Lens/Geometry)
- [darktable pixel pipeline](https://docs.darktable.org/usermanual/4.0/en/darkroom/pixelpipe/the-pixelpipe-and-module-order/)
- [ICC profile definitions](https://registry.color.org/rgb-registry/files/sRGB.pdf)

Upstream GPL editors were studied as references; their implementation code and proprietary Adobe profiles were not copied into this MIT application. Camera files, private paths, generated exports, reports and caches remain outside published source and release allowlists.
