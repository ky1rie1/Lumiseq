# Exported chart color validation

This tool measures an exported image against explicit, supplied Lab references. It does not establish camera color accuracy merely by passing numerical tests. A real camera RAW comparison against a publisher rendering is recorded below; calibrated physical chart accuracy remains unverified.

## Command

```powershell
node scripts/validate-chart-color.mjs C:\validation\chart-export-srgb16.png C:\validation\chart-reference.json C:\validation\chart-report.json
npx vitest run tests/ChartColorValidation.test.mjs
```

Omit the third argument to write JSON to stdout. Output files must be new: existing files and inputs are never overwritten. A failed run exits 1 and does not create a report. The tool adds no dependencies and does not modify application color processing.

## Capture, export and reference requirements

1. Use a real RAW photograph of a known chart, uniformly illuminated, in focus, with no glare or channel saturation. Document the camera, RAW hash, chart generation/batch, light and capture settings. A nominal manufacturer reference can assess approximate rendition; batch-specific spectrophotometer measurements under a known illuminant are needed for stronger accuracy claims.
2. Export through the application under test as full resolution, opaque sRGB PNG16. Record application version, white balance, tone/exposure settings, output size and color space. This validator also accepts PNG8 but cannot recover precision already lost. Avoid screenshots and preview resampling.
3. Provide D50-referenced CIELAB values using the CIE 1931 2 degree observer, with reference source and illuminant. When original reference values are for another adopted white, adapt them before entering the manifest and document how. Do not enter D65 Lab while declaring D50. Do not derive physical reference Lab from a displayed RGB chart illustration.
4. Set each ROI to an integer rectangle wholly inside a patch. Coordinates use the exported PNG, origin top left; `[x, y, width, height]`. Keep away from borders, shadows, glare and labels. Maximum ROI area is one million pixels.

The following complete manifest demonstrates the schema with a synthetic white patch. It is **not** a reference for any physical ColorChecker, and cannot be used as physical validation:

```json
{
  "schemaVersion": 1,
  "inputColorSpace": "sRGB",
  "capture": "Synthetic white pixel fixture; no camera capture",
  "exportSettings": "One opaque RGB PNG16 pixel, each channel 65535",
  "reference": {
    "chart": "Synthetic white fixture",
    "source": "Analytical neutral white, not measured chart data",
    "illuminant": "D50",
    "white": "D50",
    "observer": "2deg"
  },
  "patches": [
    { "id": "white", "roi": [0, 0, 1, 1], "lab": [100, 0, 0] }
  ]
}
```

Reference metadata is copied into the report. Additional chart batch, measurement geometry, light spectrum, reference license and RAW hash fields can be placed in `reference` and are retained. `capture` and `exportSettings` must be nonempty descriptions.

## Measurement conventions and limitations

- Decode noninterlaced RGB/RGBA PNG8 or PNG16, retaining original integer samples. Validate chunk CRCs and dimensions; reconstruct all five PNG row filters, operating on bytes before decoding big endian 16 bit samples. Indexed/grayscale/interlaced/animated PNGs and transparency keys are rejected. ROIs must be opaque.
- The manifest must declare sRGB. Untagged PNGs are accepted on that declaration; it remains the operator's responsibility to export actual sRGB. Standard `sRGB`, matching `gAMA=45455`, and matching sRGB `cHRM` chunks are accepted. Embedded `iCCP`/`cICP` profiles and conflicting gamma/chromaticities are rejected, not ignored or converted. For ICC-tagged exports use a properly color-managed conversion to sRGB and record that conversion. Merely deleting a non-sRGB profile is not a conversion.
- Channel-wise median RGB suppresses isolated pixel outliers, but is not necessarily an RGB triplet from one original pixel. Normalize by 255/65535, invert the sRGB transfer function, transform to XYZ D65, then apply linear Bradford adaptation and convert to Lab D50. D65 xy is `(0.3127, 0.3290)`, D50 xy `(0.3457, 0.3585)`; D50 XYZ normalized to Y=1 is recorded. No ICC black-point/flare compensation is applied.
- Report per-patch Lab, reference Lab, RGB medians, pixel count, deltaE00 with `kL=kC=kH=1`, plus mean/p95/max. P95 uses linear interpolation at `(count-1)*0.95`; clipped patches remain included. There is no fabricated pass threshold.
- Count each ROI channel at exactly zero or the maximum code, and each pixel with any such channel. These are export endpoint flags; they do not prove RAW sensor clipping. Report flags even when the median is unaffected. Tone mapping, exposure and WB all affect the resulting scores.
- Resource limits: 300 MiB encoded PNG, 512 MiB decompressed scanline data, 4 MiB reference manifest, one million pixels per ROI. This accommodates RGB PNG16 at the chart sample's 45 megapixel dimensions. Full frame images beyond these limits need an explicitly documented lossless crop around the chart, with ROIs adjusted.
- Report image/manifest absolute paths, SHA-256 hashes, timestamp and provenance. No chart reference values are bundled or guessed.

## Numeric and workflow evidence (2026-09-29)

`npx vitest run tests/ChartColorValidation.test.mjs --reporter=dot`: **56 tests passed**. RED was observed first (41/42 numeric assertions failed against stub outputs); after math implementation, 11 image/measurement assertions failed against stubs; after CLI test addition, the CLI assertion failed before its implementation. A full resolution dimension test then demonstrated the initial 256 MiB decoder limit excluded a 45 megapixel PNG16, before the limit was increased to 512 MiB. A final overflow regression failed before an explicit numeric-range guard was added, preventing absurd finite Lab values from yielding a null JSON score. GREEN covers 34 published pairs in both directions, independent primary/neutral Lab conversions, sample precision, filters, CRC rejection, ROI median/clipping, reference white/provenance, aggregate percentile and a real command subprocess writing a synthetic PNG16 report.

Maximum absolute difference from Sharma's four-decimal published deltaE00 values: `0.00004949897727168917` (below `0.00005`, the half rounding unit). This is formula verification, not a camera accuracy score. Red Lab D50 is `[54.29054294696968, 80.80492033462421, 69.89098846146234]`. D50 adapted white is numerically `[100.00000139649634, -0.000007807961388550666, 0.000007516823385955718]` with the rounded adaptation coefficients.

Sources: [Sharma/Wu/Dalal paper and supplementary data](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/), [numeric pairs](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt), [ICC sRGB registry](https://registry.color.org/rgb-registry/srgb), [ICC chromatic adaptation explanation](https://registry.color.org/rgb-registry/icctransform), [CSS Color 4 conversion reference](https://www.w3.org/TR/css-color-4/).

The numerical fixture contains published factual test coordinates/results with citation. Sharma's MATLAB/Excel programs have personal/research-use terms; **none of that source was copied**. The implementation here is original and under the project's MIT license. [Colour's implementation](https://github.com/colour-science/colour/blob/develop/colour/difference/delta_e.py) and [BSD-3-Clause license](https://github.com/colour-science/colour/blob/develop/LICENSE) were reviewed as an open-source reference; no runtime dependency or copied code was added.

## Dataset research and license verdict

| Source | Actual content and data license | Use verdict |
| --- | --- | --- |
| [Poly Haven Outdoor Workshop](https://polyhaven.com/a/outdoor_workshop), [asset license](https://polyhaven.com/license) | CC0 asset. Its linked Color Chart ZIP contains `DSC_8832.NEF` (64,521,357 bytes), `DSC_8832.tif`, and `merged_000.exr`, verified by HTTP range inspection of the ZIP central directory. ZIP size 69,138,240 bytes; publisher MD5 `2d5f71d5cfd3e894e10e9007a5749b2f`. | Usable real chart RAW for decoder/export smoke checks. No supplied measured Lab/illuminant spectrum has been established, so no calibrated deltaE claim. Keep downloads outside source/build artifacts. |
| [USDA controlled environment correction dataset](https://catalog.data.gov/dataset/data-from-systematic-color-correction-pipeline-for-controlled-environment-imaging), [publisher metadata](https://api.figshare.com/v2/articles/31256776) | Explicit dataset CC0. ZIP directory has 458 entries: 368 JPG, 36 CSV, 4 PNG, 2 TXT, 1 JSON and directories. No camera RAW extension; inspected central directory without downloading the 958 MB archive. | Legal data use is clear, but “raw data” means original experiment data here; unsuitable to test camera RAW decoding. |
| [Sony a7 IV chart donation, RawTherapee issue 6636](https://github.com/RawTherapee/RawTherapee/issues/6636) | Photographer explicitly offers chart ARW/DNG under CC0. Gofile link timed out during this run. | License-clear potential alternate source; files were not retrieved/verified. Repository software license is not the data license. |
| [raw.pixls.us](https://raw.pixls.us/) | Explicit per-file licensing, CC0 for new contributions; site explicitly does not seek color targets. | Useful camera format samples, not an established chart/reference accuracy dataset. Check each file's license. |
| [Middlebury Color Dataset](https://vision.middlebury.edu/color/data/) | Publisher grants use/publication with citation; chart “RAW” images have already been rendered by dcraw to linear PNGs and registered/composited. | Can inform separate reference research; cannot exercise this application's camera RAW decoder. |

**Remaining physical validation:** Native decoding/export and inspected patch ROIs are now demonstrated for publisher-rendering comparison below. Supply traceable chart Lab references and capture illumination for a physical accuracy measurement. Report nominal or measured reference status honestly. A low synthetic-fixture error or a correct formula cannot replace this run.

Local external dataset download was verified against the publisher MD5. Archive SHA-256 is `1bf307d7b5eaed3622295fa86bca691a01622a92afdc19f464c32d84f301439c`; extracted NEF SHA-256 is `f9313075a04023e62d55c7aa36fe0ce42a2b021b231ee5b57f3b1f5b0b958326`. No camera media was added to the repository.

## Real native RAW comparison against publisher rendering

The actual Nikon Z 7 NEF was decoded/exported through the native implementation as neutral RGBA PNG16, 5520×8288. The publisher supplies a 418×607 RGB16 chart crop made by RawTherapee 5.8, with embedded `RTv4_sRGB` ICC profile. Profile inspection established an RGB-to-XYZ D50 matrix, equal parametric type 4 TRCs and D50 PCS white. Its ICC profile SHA-256 is `17aebbdf8a88c39b07eb881dcd824eb1cf9828914d5e74a7324d7a31045e8871`. TIFF Deflate/horizontal-predictor samples were retained at 16 bit; upper bytes exactly matched Pillow's independent TIFF RGB8 decode. Reference patch medians were converted using the actual embedded ICC TRCs/matrix, then Bradford adapted from ICC PCS white to the explicit D50 xy used here. The ICC adaptation tag was not applied again.

EXIF indicates 2021-06-02 15:08:38, ISO64, 1/125s, manual white balance and orientation8. The asset lists outdoor natural light and processing WB5319K. This is not a measured illumination spectrum. Visual identification is a Passport-style foldout with a lower classic 24-patch panel; the exact chart batch/generation is unknown. Its EXR has no chromaticities attribute, so its RGB color space was not assumed.

The publisher crop was registered to the actual full native export at translation **+2199,+6377**, with normalized grayscale correlation **0.9990506904391586**. This differs from the embedded camera JPEG translation because native dimensions include a border. The central 10×10 ROIs for all 24 lower-panel patches were visually inspected in a side-by-side annotated crop.

The **before v0.7.3** unadjusted rendering comparison produced **mean ΔE00 16.82420692, p95 19.79880910, max 19.97731695**, with **one clipped patch**. Native patch19 was fully clipped at the exported RGB endpoints. Neutral patches20–24 had native/reference luminance ratios **2.335999–2.344172**, or **+1.224040–1.229078 EV**. The almost constant luminance ratio exposed a systematic exposure scale difference. Investigation identified LibRaw histogram auto brightening still enabled despite linear gamma output. The native fix explicitly sets `no_auto_bright=1` and `bright=1.0`.

The corrected **v0.8.0** NEF was decoded/exported again through the native implementation, measured at the **same ROIs** against the **same publisher ICC references**:

| Metric | Before v0.7.3 | Corrected v0.8.0 |
| --- | ---: | ---: |
| Mean ΔE00 | 16.82420692 | 1.54710100 |
| P95 ΔE00 | 19.79880910 | 2.58142869 |
| Maximum ΔE00 | 19.97731695 | 2.76763267 |
| Clipped patch ROIs | 1 | 0 |

Corrected neutral luminance ratios are **0.991228–0.994701**, or **−0.012711 to −0.007666 EV**. The white ROI has L*=**73.5463**, against publisher **73.8498**, with no exported endpoint clipping in its 100 pixels. Rechecked registration correlation is **0.9992085274546679**, with the same +2199,+6377 translation. No exposure, WB or color fitting was applied to the report. This verifies removal of the unintended native brightness boost and improves **publisher rendering agreement**; it does not establish **calibrated physical chart accuracy**, since publisher processing settings, chart generation and illumination spectrum remain uncertain.

Before PNG SHA-256: `a43240e210a30d9ef8121c52eeaff964e500463f3fb7664a3e7ab0e2bae11336`. Corrected PNG SHA-256: `beffe18e48f1968d4efc68ebcc520f019c3d36ca3ce705b554ea3162874359cf`. Corrected manifest SHA-256: `c3d33869db869152a5df71bdb24af24d508138cf81e7796cf23f94168e260f72`.

As a conversion check, the publisher TIFF was explicitly converted to standard sRGB PNG16, and the validator measured that converted image against its source ICC medians: mean `0.0006470965`, p95 `0.0010770440`, max `0.0011896987`, no clipped patch ROIs. This checks conversion/quantization agreement only.

External artifacts reside in the session's `chart-color-validation` directory: `lumiseq-native-publisher-reference.json`, `lumiseq-native-vs-publisher-after-autobright-fix.json`, `chart-before-after-summary.json`, `chart-before-after-report.md`, and `chart-publisher-lumiseq-before-after.png`. Baseline report/crop/reference artifacts are preserved as `*-before-autobright-fix.json/.png/.md`. Reports record image/manifest hashes and metadata. Media and generated reports remain outside the source repository. Matching batch-specific chart Lab and capture illumination are still required for a physical accuracy result.
