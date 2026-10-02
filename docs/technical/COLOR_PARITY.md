# Color parity evidence audit for 0.9

> New 2026-10-02 float-pipeline exports were measured against the same frozen references: Outdoor Workshop mean 1.552104, p95 2.585749, maximum 2.764385; Garden Nook mean 1.434303, p95 2.183306, maximum 2.256972. Both had zero clipped patch windows. These small changes are within the prior sampling sensitivity, not evidence of improved physical accuracy. See [current RAW quality](../RAW_QUALITY.md).

Audited 2026-09-29. This audit changes documentation only. Existing application code, exports and benchmark manifests remain unchanged. The second CC0 chart archive was downloaded and measured outside the repository using the existing opt-in native test and color CLI. No software was installed, and no exposure, WB or color correction was fitted to either chart.

## What the current result establishes

The [existing chart report](COLOR_MEASUREMENT.md) and [0.8.0 release record](../releases/v0.8.0.md) describe a genuine Nikon Z7 NEF export comparison against its publisher's RawTherapee 5.8 chart TIFF. The reference uses the actual embedded `RTv4_sRGB` profile rather than assuming TIFF sample codes are standard sRGB. The 24 frozen patch windows, independent numeric deltaE tests, verified reference conversion, image/manifest hashes and zero adjustment fitting make this useful regression evidence.

The corrected export has mean ΔE00 **1.547101**, p95 **2.581429**, maximum **2.767633**, and no endpoint-clipped patch windows. The former **16.824207** mean was largely a uniform brightness error; disabling LibRaw histogram auto brightening removed that unintended shift. This is **agreement with one publisher rendering**, with one camera, chart, capture and processing chain. It does not establish general camera color fidelity, agreement with Adobe/Capture One, display accuracy or measured physical target accuracy.

The corrected report still has signed neutral residuals: all six neutral patches have lower native L*, a* and b* than their publisher references. Neutral mean ΔE00 is **1.342036**; the 18 chromatic patches' mean is **1.615456**. This is a diagnostic observation, not evidence to invent a per-camera color correction. Camera WB, input profile, processing and registration differences remain possible causes. Separate signed ΔL*, Δa*, Δb* and neutral XYZ luminance ratios from a single aggregate score when investigating future changes.

## Measured window sensitivity

The existing native full PNG16 was decoded once using the production validator's PNG reader. The publisher Lab references stayed fixed. All 24 native patch windows were then sampled at **8, 10 and 12 pixel square sizes**, centered on the original 10×10 windows, with each of the nine **±1 pixel x/y offsets**: 27 prespecified variants, without tuning parameters or changing colors.

| Fixed-reference native window sensitivity | Minimum | Maximum |
| --- | ---: | ---: |
| Mean ΔE00 | 1.539452 | 1.564481 |
| P95 ΔE00 | 2.488666 | 2.642133 |
| Maximum ΔE00 | 2.647660 | 2.873784 |
| Endpoint-clipped patches | 0 | 0 |

The largest individual patch score spread was patch24 **0.640300**, followed by patch19 **0.316762** and patch23 **0.282842**. A small change in one patch's error can therefore reflect sampling on this small, soft chart. These ranges are descriptive sensitivity checks, **not confidence intervals**, and do not yet include reference-window or registration-model uncertainty. Report the frozen baseline as the headline and prespecified sensitivity separately; do not choose whichever window produces the best score.

Inputs: native PNG SHA-256 `beffe18e48f1968d4efc68ebcc520f019c3d36ca3ce705b554ea3162874359cf`; frozen manifest SHA-256 `c3d33869db869152a5df71bdb24af24d508138cf81e7796cf23f94168e260f72`. The original files remain in the external session `chart-color-validation` directory.

## Second real RAW/reference pair: acquired and measured

[Poly Haven Garden Nook](https://polyhaven.com/a/garden_nook) provides a public [Color Chart archive](https://dl.polyhaven.org/file/ph-assets/HDRIs/extra/Color%20Charts/garden_nook.zip). Assets are [CC0](https://polyhaven.com/license); website prose and public API terms have separate rules. Publisher file metadata and archive contents were inspected through byte-range requests:

| Item | Verified observation |
| --- | --- |
| Archive | 67,136,396 bytes; publisher MD5 `0b0ab837232d8cbdbef8ddcd51eb7024` |
| Actual camera RAW | `DSC_8680.NEF`, 65,644,081 bytes; RAW header identifies Nikon Z7 |
| Publisher reference | `DSC_8680.tif`, 598,476 bytes; 299×394 RGB, 16 bits per channel; metadata says RawTherapee 5.8 |
| TIFF SHA-256 | `acd27eb0d853118384f7730d1834499262f62d942dcd88c7c36e9deda4ab72f9` |
| Embedded profile | RGB to XYZ PCS; matrix tags and three parametric type4 TRCs; `RTv4_sRGB` |
| ICC SHA-256 | `17aebbdf8a88c39b07eb881dcd824eb1cf9828914d5e74a7324d7a31045e8871`, exactly the existing benchmark's profile |
| Other file | `merged_000.exr`; its color space was not assumed |

The complete ZIP MD5 now independently matches the publisher value, and every archive entry passed its ZIP CRC check. ZIP SHA-256 is `74e44c828d0751b94490120ad31a5636107c229fa916b4e0228a9843dcb022d7`; extracted RAW SHA-256 is `33722db60e8033945022e107aec2c6974c58cb11b5dc49b81b61b58f91239578`.

### Actual native export and reference measurement

The existing ignored `raw::develop::tests::real_camera_raw_spatial_export_validation` test was executed with `LUMISEQ_RAW_VALIDATION` pointing to the verified NEF, `LUMISEQ_RAW_REPORT_DIR` pointing to an external new `garden_nook/native` directory, and `LUMISEQ_RAW_CASES=neutral`. No new Rust test or production code was required. As-shot WB, exposure zero, empty curves/HSL and every develop adjustment zero were retained; LibRaw's `no_auto_bright=1, bright=1.0` remained enabled.

Native test **1/1 passed**: camera Z7, **5520×8288 RGBA16**, **264,929,924-byte PNG**; decode **5.289 seconds**, export **38.467 seconds**. The export contains the current explicit sRGB/gAMA/cHRM metadata. Its SHA-256 is `cd44ce15970f9e86fba29eb659a8cfd793755d50e331f48f8fa66976ea3ac7bd`.

The publisher reference was decoded from TIFF Deflate strips and its horizontal predictor with full 16-bit samples. Every upper byte exactly matched an independent Pillow RGB8 decode. Reference Lab was calculated from channel medians using the actual embedded type4 ICC TRC and RGB-to-XYZ matrix, followed by PCS-white-to-explicit-D50 Bradford adaptation. The ICC chromatic-adaptation tag was not applied twice. A converted sRGB16 self-check produced mean ΔE00 **0.000683**, p95 **0.001533**, maximum **0.001986**, with no clipped patch windows.

All **24 classic patches in the upper panel** were selected before any native color score. The panel is rotated 180° relative to canonical patch order. Ten-pixel square source windows were visually centered inside each patch. Publisher processing also rotated the whole crop, so this capture needed a six-parameter affine map rather than a pure translation. Four visible patch centers initialized a grayscale correlation registration, with no exposure/WB/color fitting. The final map from publisher coordinates to full native coordinates is:

```text
x_native =  0.8391484236*x + 0.5436266781*y + 2521.8903900
y_native = -0.5436794447*x + 0.8390459057*y + 5703.0645533
```

Registration grayscale correlation is **0.999367407**. All 24 mapped central 10×10 native integer windows were visually inspected in the annotated full-native chart crop. The measurement CLI reads the actual full PNG16; affine-resampled RGB8 comparison images are visual aids only. Frozen manifest SHA-256 is `4759cc8deb8255d1324bd4c18649a05502e58c4dadcbecf15eabbdd415bb5ea3`.

| Separate capture comparison | Outdoor Workshop, prior 0.8.0 record | Garden Nook, current native holdout |
| --- | ---: | ---: |
| Patch count | 24 | 24 |
| Mean ΔE00 | 1.547101 | **1.429440** |
| P95 ΔE00 | 2.581429 | **2.184589** |
| Maximum ΔE00 | 2.767633 | **2.253103** |
| Endpoint-clipped patch windows | 0 | **0** |

Garden Nook's chromatic-patch mean is **1.347426**, neutral-patch mean **1.675481**. Neutral XYZ luminance ratios range from **0.987284 to 0.991935** (about **−0.01846 to −0.01168 EV**). No luminance ratio was used to compensate exposure. The different scores belong to different captures and are not a before/after color improvement comparison.

External artifacts are under the session `chart-color-validation/garden_nook` directory: `dataset-source.json`, original archive/NEF/TIFF, `native/report.json`, `native/neutral-full.png`, `publisher-source-reference.json`, `native-publisher-reference.json`, `publisher-conversion-selfcheck.json`, `native-vs-publisher.json`, `benchmark-summary.json`, `native-registration.json`, source/native annotated ROI images and `garden-publisher-native-comparison.png`. Original helper scripts `prepare-publisher-reference.py` and `register-chart.py` retain the conversion and registration procedure. They preserve the existing RAW and original benchmark inputs. Large camera media, exports and generated reports were not added to Git.

**Coverage limit:** API capture timestamps are 1,622,645,520 for Garden Nook and 1,622,646,300 for Outdoor Workshop, only **13 minutes apart**. Both identify the same camera and photographers; both are natural-light assets. Garden Nook adds a second frame/scene, but does not provide an independent camera or confidently separate illuminant. Publisher WB5303K is processing metadata, not a measured illumination spectrum. [Publisher API info](https://api.polyhaven.com/info/garden_nook) and [file metadata](https://api.polyhaven.com/files/garden_nook).

## Candidates that should not be called established reference coverage

- [Workshop](https://polyhaven.com/a/workshop) is the more valuable artificial-light holdout. Its 223,593,498-byte archive (publisher MD5 `c9110a511396fc877f080237c3986c57`) contains `DSC_8607.NEF` (52,434,389 bytes), `DSC_8607.tif` (49,702,948 bytes) and `merged_000.exr`, confirmed from the ZIP directory. The TIFF ICC, camera model, chart quality and reference suitability were **not** inspected in this run; this remains a candidate, not a usable validated reference. [Publisher file metadata](https://api.polyhaven.com/files/workshop).
- [Studio Small 09](https://polyhaven.com/a/studio_small_09) advertises artificial light/WB2750K and provides actual `DSC_9975.NEF`, but its chart ZIP only pairs it with `HDR.hdr`. Brown Photostudio 02 similarly has NEF/DNG plus `HDR.hdr`. An RGBE HDR file does not embed an ICC reference; these files cannot be declared sRGB or treated as physical Lab truth without additional publisher color-space evidence.
- The existing Sony chart donation remains a possible different-camera source. A verified retrievable RAW and properly described reference rendering are still necessary. Repository software licenses do not establish donated image licenses.

## Fair native/publisher comparison coverage

| Comparison | Required controls | Permitted conclusion |
| --- | --- | --- |
| Numeric color math | Published numeric test pairs, independent sRGB/Lab/white-point fixtures | Formula agreement |
| Native vs publisher | Same RAW scene, orientation/geometry registration, known output ICC conversion, frozen ROIs, unadjusted output and no target fitting | Agreement with that publisher render |
| Native vs professional editor | Same RAW; record application/process version, input profile, WB, exposure, tone curve, sharpening/NR, lens corrections and output intent | Agreement under the stated recipe; slider zero alone is insufficient |
| Preview vs native export | Same source positions/settings; compare linear floats or account for precision/quantization | Internal rendering consistency |
| Physical chart accuracy | Correct target generation/batch, measured spectra or traceable applicable Lab, known illuminant/observer, suitable capture geometry | Accuracy for those measured conditions |
| Display fidelity | Tagged output plus measured/calibrated display and documented viewing conditions | Displayed appearance under those conditions |

For 0.9, retain Outdoor Workshop as a frozen regression and the now-measured Garden Nook frame as a holdout. A verified artificial-light pair and a different camera remain future coverage gaps. Current publisher-rendering evidence covers **two frames, one camera model, natural-light captures 13 minutes apart, and one publisher/profile pipeline**. Track each capture's 24-patch table, mean/p95/max, neutral/chromatic groups, signed Lab residuals and clipping. Retain baseline results before enabling any new rendering intent. Do not bundle proprietary camera profiles or borrow GPL implementation code.

## Current official professional color/UI references

These are current official documentation pages checked on 2026-09-29, not claims that proprietary profile output can be cloned:

- **Adobe Lightroom Classic:** profiles sit at the top of Basic and set the color/tone foundation; Adobe Color is the default, while camera-matching and adaptive profiles serve different rendering intentions. Zero sliders do not mean an unprofiled, linear-neutral default. [Tone and profile documentation](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/image-tone-color.html).
- **Adobe color controls:** the Color Mixer has Mixer and Point Color views; the latter has a picker, hue/saturation/luminance adjustments and affected-range visualization. The official page is dated 2025-10-27. [Color Mixer documentation](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/color-mixer.html). Reference View supports RGB/Lab readings, and Develop panels can be reordered/hidden. [Develop tools](https://helpx.adobe.com/lightroom-classic/desktop/process-and-develop-photos/develop-module-tools.html).
- **Capture One:** Base Characteristics explicitly combines camera ICC selection and tone curve. [Panel overview](https://support.captureone.com/hc/en-us/articles/360002588917-The-Base-Characteristics-panel-overview). Its 2026-02-05 documentation for 16.7.3 distinguishes final-output EcommStandard from diagnostic EcommReference, including Nikon Z7 support. This is useful evidence for labeling rendering purpose, rather than calling every attractive default colorimetrically neutral. [E-commerce profiles](https://support.captureone.com/hc/en-us/articles/33593506104605-E-commerce-ICC-profiles-Studio).
- **darktable 5.6:** color calibration reports before/after adaptation/matrix errors and warns that a fitted chart result does not cover the complete spectrum; capture/reference generation and illumination matter. [Color calibration](https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/color-calibration/).
- **RawTherapee:** input, working and output profiles have distinct roles; DCP tone curves and profile tables affect appearance, and profiles intended for different lights cannot be equated with a plain matrix transform. [Color management](https://rawpedia.pixls.us/color_management/).

Practical UI implication: expose the active rendering intent/profile beside WB and basic tone; keep mathematical sampling/reference diagnostics legible; place targeted color controls together with an affected-range preview. These are workflow recommendations grounded in official behavior. UI styling and controls do not by themselves establish color fidelity.
