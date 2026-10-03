# RAW 空间处理

照片调色和智能对象滤镜分别拥有自己的参数与处理管线。RAW 的细节处理覆盖预览、原始像素细节和原生全尺寸导出。

## RAW 管线

| 处理 | 方法与实现入口 |
| --- | --- |
| 纹理 / 清晰度 | 新版采用完整归一化高斯导向滤波、对数亮度细节与星点保护；`src/engine/developDetailV2.ts`、原生 `raw/detail_v2.rs`；旧版保留 `raw/detail.rs` |
| 去雾 | 全幅大气光、暗通道与导向滤波；[方法说明](DEHAZE.md) |
| 亮度 / 色彩降噪 | 三层 B3 样条小波、亮度与色彩阈值分离；`src/engine/waveletDenoise.ts`、原生 `raw/wavelet.rs` |
| 锐化 | 当前处理阶段的高斯反差增强，带连续阈值、噪声过渡和新增暗晕控制 |

概览采用缩放相关的采样半径，原始细节裁块包含邻域支撑后再裁剪。原生导出使用带邻域的条带以控制峰值内存。全图分析由实际源图像提供，避免不同局部裁块各自估计大气光。

CPU 数学参考、生产 GPU 与原生实现有独立回归入口。参见 `integration/raw-spatial-validation.html`、`integration/spatial-quality-validation.html` 和 [真实 RAW 验证](../../tests/raw-fixtures/README.md)。

新版独立入口为 `integration/raw-quality-v2-validation.html`，检查圆形与亚像素星点、旋转对称、有效锐化、负纹理平滑及 signed/HDR 保留。`settings.renderingVersion` 缺失时使用旧版 1；新文档使用 2。重置不会迁移版本，显式升级会创建独立调色副本。细节算法与原尺寸验收范围见 [RAW 质量](../RAW_QUALITY.md)。

## 智能对象滤镜

`src/filters/smartFilters.ts` 提供模糊、反差锐化与保边降噪；`src/commands/edit/SmartFilterCommands.ts` 管理顺序、参数和撤销。它们应用于智能对象的隔离像素缓冲，计算结果按来源、尺寸与参数缓存，之后再进入图层蒙版和混合。

这组滤镜处理编辑工作区像素，与 RAW 的三层小波管线独立。滤镜的序列与设置保存到项目中。

## 边界

当前没有机型 / ISO 噪声模型，也没有对所有场景建立统一质量结论。降噪和锐化可能影响纹理，去雾可能改变颜色与对比度，实际结果需要代表性图像检查。RAW 解码、颜色空间和输出精度详见 [色彩输出约定](COLOR_OUTPUT.md)。
