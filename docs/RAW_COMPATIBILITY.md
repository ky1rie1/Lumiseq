# RAW compatibility

Lumiseq develops sensor data rather than substituting the camera's embedded JPEG. This page describes the current **unreleased RAW repair**, tested on Windows x64 on 2026-10-02. It does not describe the already published 0.9.7 binary.

## Verified scope

The codec audit passed **65 of 72 public captures**. The current float pipeline was separately exercised on **63 passing CC0 captures** plus a private Sony ILCE-6700 ARW; two Sony mapping failures were corrected and rechecked. The two noncommercial references belong to the earlier codec audit, not the new float quality result. The corpus spans 54 manufacturer labels, including phones, drones and scanners. A brand or extension match does not guarantee every camera, firmware revision or compression mode.

The [sample metadata](../tests/raw-fixtures/camera-corpus.json) identifies each model, publisher URL, SHA-256, license and expected decoding status. Camera files and generated reports are excluded from Git and release packages. Of the public captures, 70 are CC0; the Mamiya ZD and Polaroid x530 captures are noncommercial research references and are excluded from automatic downloads.

| Family | Actual passing coverage |
| --- | --- |
| Canon | CRW, CR2 including full RAW and sRAW; CR3 including EOS R6 / R6 Mark II variants |
| Nikon | Ordinary NEF including Z6 / Z6 III; COOLPIX NRW; scanner NEF |
| Sony | ARW including A7S, A7 III uncompressed, A7 IV lossless; SR2 and SRF; private A6700 ARW |
| Fujifilm | FinePix RAF and compressed X-Trans X-T2 RAF |
| Panasonic / Olympus / OM System | RW2 and ORF |
| Pentax / Ricoh / Leica | PEF and DNG, including monochrome Leica DNG |
| Medium format | Hasselblad 3FR / FFF; Phase One IIQ; Leaf MOS; Mamiya MEF; Sinarback STI |
| Other cameras | Sigma / Polaroid X3F; Samsung SRW; Kodak KDC / DCR; Minolta MRW; Epson ERF |
| Action cameras | GoPro HERO7 Black GPR via the official SDK; GITUP GIT2 RAW |
| Phones / drones / computational cameras | 29 DNG captures, including Apple, Google, DJI, Huawei, Xiaomi and the 64.6 MP Light L16 |

Each successful sample exercised the production decoder, bounded overview, original-coordinate linear tile, PNG tile and native adjustment/export pipeline. Export was a **16-bit PNG with +4 EV at a reduced delivery size**; this checks native processing of the decoded source but does not claim full-size file-output testing for all 72 samples. No physical color-chart accuracy, manufacturer rendition match or AI aesthetic judgement is implied.

## Remaining unsupported variants

| Sample | Current boundary | Practical route |
| --- | --- | --- |
| Nikon Z6 III, two HE / HE* captures | LibRaw's Nikon HE decoder is an unsupported stub in this build; ordinary compressed NEF passes | Capture in Lossless Compressed NEF. Existing HE captures need a converter that actually supports HE and preserves sensor data. |
| SJCAM SJ6 LEGEND, narrow field of view | Headerless proprietary RAW; requires exact dimensions, CFA and camera calibration | Convert with a tool and calibration profile for that precise camera/mode. |
| Paralenz Dive Camera | Headerless RAW is not identified by the bundled decoder | Use a camera-specific sensor-DNG converter. |
| Xiro Xplorer V | Headerless RAW is not identified | Use a camera-specific sensor-DNG converter. |
| ImBack ImB35mm | Proprietary/headerless RAW is not identified | Use the manufacturer's conversion workflow. |
| Casio QV-11 CAM | This legacy camera container is not decoded or registered as an editable RAW format | Use a compatible legacy converter; changing the extension does not convert it. |

These seven captures intentionally fail the all-samples native gate. They are not silently replaced by JPEGs. Registering an extension alone cannot add a codec. A TIFF/JPEG rendition can be edited as a raster image but does not retain RAW latitude. Universal support remains unfinished.

## Working precision and optical correction

The development candidate now applies the Sony capture's active crop and embedded lens correction tables before float camera-to-working conversion. Its corrected 6192×4128 output no longer shows the previous large black corner shapes. Full-size TIFF16/P3, four original-resolution corners and two full-size Nikon chart exports were verified. See [RAW quality evidence](RAW_QUALITY.md) for results and limits.

Previously, RAW was converted to an 8-bit display PNG **before** editor exposure adjustment. Very small positive linear values became zero and could not brighten. New projects now attach a bounded LF32 linear overview and exact-resolution tiles to the existing engine. Verified RGBA32F GPU targets, CPU rendering and AI observations consume the same signed/headroom source. Camera white balance is not applied twice. Legacy projects retain their original decoder and coordinate version.

The corrected Sony A6700 corner probe and asymmetric/float fixtures passed real WebGL2 and WebView2 binary IPC. GPU/CPU output differed by at most one 8-bit channel value in the Sony probes at 0, +1.70 and +4 EV. This is preview verification, not bit-for-bit equality with native export. Truly zero pixels after black-level subtraction remain zero; exposure cannot recover missing sensor information.

Overview transport is capped at a 2048-pixel edge. Detail transport is capped at 4096 per side and six million pixels. The master remains native RGBA32F extended linear sRGB. Integer black subtraction/demosaic still precedes float WB/matrix conversion. Floating sensor DNG is explicitly unsupported, preventing silent integer conversion of HDR sensor samples. No Camera Raw parity or physical chart calibration is claimed.

## Reproduce without adding photos to the repository

```powershell
# Default: only passing CC0 fixtures; downloads remain outside the checkout.
.\scripts\prepare-raw-corpus.ps1
$env:LUMISEQ_RAW_CORPUS = Join-Path $env:LOCALAPPDATA 'AI-Creative-Studio\raw-validation-samples\lumiseq-corpus.local.json'
$env:LUMISEQ_RAW_REPORT_DIR = Join-Path (Get-Location) 'generated-test-output\raw-corpus'
& .\scripts\run-cargo.ps1 test --lib --release real_camera_raw_compatibility_matrix '--' --ignored --nocapture
```

Use `-ExistingOnly` to verify cached samples without downloading, `-Limit` for a small run, and `-IncludeUnsupported` to reproduce negative cases. The size budget defaults to 2 GiB. Samples are SHA-256 checked before entering the local manifest. Large previews are not retained unless `LUMISEQ_RAW_KEEP_PREVIEWS=1` is explicitly set. Reports and native exports go into the ignored output directory.

DPReview's studio comparison was inspected, but its RAW download endpoint returned HTTP 403 in this environment. Actual compatibility captures came from [raw.pixls.us](https://raw.pixls.us/); they are not presented as DPReview downloads. Compare the upstream [LibRaw camera list](https://www.libraw.org/supported-cameras) with build features and real samples, rather than treating the upstream list as our verified coverage.

## 中文说明

解码器兼容性审核通过 72 张公开样本中的 65 张；新版浮点管线另测了 63 张通过的 CC0 样本和用户的索尼 A6700。两张非商用参考只计入此前的解码审核。共覆盖 54 个厂商标签；包含手机、无人机和扫描仪，不代表所有品牌、机型与压缩模式都通过。

新版已解决预览过早量化，并读取索尼有效裁切及内嵌畸变／色差／暗角校正。工作数据为 RGBA32F，整图、原尺寸局部与 AI 共用；真正低于黑电平或已饱和的传感器信息仍无法靠曝光恢复。

这张索尼文件已生成 6192×4128 的全尺寸 Display P3 TIFF16，原先大片黑角已消失；四角原尺寸和 +1.70／+4 EV 检查已生成。两张 Nikon Z7 的全尺寸色卡回归也已复测。以上不代表 Adobe Color 渲染完全一致或物理色准认证，详见[质量说明](RAW_QUALITY.md)。

当前明确未支持：尼康 HE／HE* 两张样本、SJCAM SJ6 LEGEND 窄视角 RAW、Paralenz、Xiro、ImBack 的特殊 RAW，以及 Casio QV-11 CAM。普通尼康 NEF 已通过。特殊 RAW 必须使用准确的传感器布局和相机校准，不能靠猜尺寸或修改扩展名冒充支持。

样本验证涵盖真实解码、预览、原尺寸局部、原生处理和缩小尺寸的 16 位输出；没有宣称每张都做了全尺寸输出或物理色卡校准。DPReview 下载在当前环境返回 403，因此改用许可明确的 raw.pixls.us 样本。照片、缓存和测试记录均不进入仓库或发布包。
