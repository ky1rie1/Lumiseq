# Global haze analysis

## Design and integration contract

This is an original TypeScript and Rust implementation of published dark-channel and guided-filter equations. No darktable or RawTherapee program source was used or copied. The new files remain covered by this repository's MIT license.

`analyzeHaze(Float32Array, width, height)` and Rust `haze::analyze(&[[f32; 3]], width, height)` require finite, interleaved, top-origin RGB from a bounded overview of the **complete uncropped image**, after base tone and before spatial corrections. Dimensions must match the buffer and contain at most 65,536 pixels. TypeScript rejects invalid inputs with `RangeError`; Rust asserts this internal precondition. Signed RGB is floored at zero for analysis only. HDR values above one remain available to atmosphere estimation and are not clipped by reconstruction.

The serializable profile is `{version: 1, width, height, atmosphere: [r,g,b], coefficients: [a0,b0,a1,b1,...]}`. Fields have identical names in Rust and TypeScript. `width` and `height` describe the coefficient grid, whose longest side is at most 256. Non-overlapping area averages reduce larger inputs. Coefficients are row-major with the top row first. Rust emits `f32`, while TypeScript keeps double precision numbers.

`applyHaze(rgb, profile, xNormalized, yNormalized, amount)` and Rust `haze::apply` take full-source normalized coordinates with a top-left origin. Crops and native detail tiles map their pixel centers into that source frame. Profile sampling follows GL clamp-to-edge bilinear sampling at `(x * width - 0.5, y * height - 0.5)`. GPU upload must preserve the top-origin row order or invert its sampler Y consistently. Atmosphere and coefficient textures must retain float values; an 8-bit texture loses the guided coefficients' signed values.

## Algorithm

1. Compute RGB minimum and a square spatial minimum filter. Its radius is `max(1, round(2 * longSide / 256))`.
2. Estimate one RGB atmosphere for the entire scene. Rank supported samples by their local dark value, keep the brightest 5% of dark values, then average RGB from the brightest 5% by luminance within that set. Stable row-index tie breaking matches the two languages.
3. Reject isolated bright candidates whose point minimum exceeds `1.25 * localMinimum + 0.02`. Reject display-clipped white candidates (all channels at least `0.9999`) only when the whole analyzed image remains at or below `1.0001`. If fewer than 5% of all pixels remain, fall back to the original set. This does not discard bright HDR atmosphere samples. Nonblack atmospheric channels have a `0.05` denominator floor. An entirely black image returns zero atmosphere and zero coefficients.
4. Normalize each RGB channel by the measured corresponding atmospheric channel and spatially minimize to obtain haze `p`. Use guidance luminance `I = 0.2126 R + 0.7152 G + 0.0722 B`.
5. At `r = max(1, round(4 * longSide / 256))`, compute box means of `I`, `p`, `I*I`, and `I*p`. Derive `a = covariance(I,p) / (max(0, variance(I)) + 0.0001)` and `b = mean(p) - a * mean(I)`. Box-average **both coefficient fields again**. Integral box means count the actual truncated window at boundaries and work for single-row images.
6. At render resolution, interpolate `mean_a` and `mean_b`, and recover `haze = clamp(mean_a * Y + mean_b, 0, 1)`. For positive strength `s = clamp(amount/100, 0, 1)`, use `t = max(0.15, 1 - 0.9*s*haze)` and `J = A + (I-A)/t`. Negative strength adds the measured atmosphere: `I + (A-I)*(-amount/100)*0.26`, with slider input limited to ±100. Zero returns the original RGB exactly. Reconstruction does not clamp RGB.

The 5%/5% selection, support/clipping checks, epsilon, strength retention, and transmission floor are explicit project choices. They are not claims of identical darktable or RawTherapee output. A single-image prior cannot reliably distinguish a large unclipped bright object from atmosphere, and scenes without haze can still change under positive strength. Cache the profile from the whole image, excluding dehaze amount from its key, and reuse it for overview, detail, and export.

## Implementation and verification plan

- Define the serialized contract and independently derived synthetic fixtures first.
- Implement matched bounded sampling, atmosphere selection, normalized dark channel, and two-pass guided coefficients.
- Share the profile across source-coordinate consumers and upload floating-point coefficients to the GPU.
- Verify colored haze reconstruction, clear dark foreground, clipped white background, sparse bright point, HDR atmosphere, negative addition, exact zero identity, black guard, coarse-grid limits, dimension/finite checks, and an asymmetric bilinear profile.
- Verify an independent three-pixel guided-filter reference with literal coefficients to catch omitted coefficient averaging.

## Primary sources

- [He, Sun and Tang: Single Image Haze Removal using Dark Channel Prior](https://people.csail.mit.edu/kaiming/cvpr09/index.html): physical haze model and dark-channel prior.
- [He, Sun and Tang: Guided Image Filtering](https://people.csail.mit.edu/kaiming/eccv10/index.html): local linear coefficients and the second box-mean pass.
- [He and Sun: Fast Guided Filter](https://arxiv.org/abs/1505.00996): coarse coefficient estimation and high-resolution guidance reconstruction.
- [darktable 5.6 haze removal manual](https://docs.darktable.org/usermanual/5.6/en/module-reference/processing-modules/haze-removal/): linear RGB haze correction, regional haze estimation, diffuse light removal, negative strength, and limitations on clear scenes.
- [RawTherapee Haze Removal manual](https://rawpedia.rawtherapee.com/Haze_Removal): atmosphere correction, strength/depth controls, depth-map interpretation, and possible color casts. Its public documentation does not specify our 5%/5% atmospheric estimator.
