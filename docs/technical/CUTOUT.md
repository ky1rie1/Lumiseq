# 抠图算法选择与实现边界

检索与实现日期：2026-09-26。目标是 Windows 本地、可人工修正、可验证、体积可控的抠图。没有足够对照数据证明达到 Photoshop 精度。

## Adobe 的公开方法

Adobe 官方公开的工作流是 Select Subject / Object Selection 建立初始选择，再到 Select and Mask 使用 Refine Hair、Object Aware、Refine Edge Brush 和边缘调整，最后输出蒙版。设备和云端计算提供不同处理选择。Adobe 没有在这些材料中公开完整生产模型、训练数据或可直接复用的实现，不能把某个开源模型宣称为 Photoshop 内部算法。

来源：[Select Subject](https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/detect-subject-using-select-subject.html)、[Refine Hair](https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/make-improved-hair-selections.html)、[Select and Mask 教程](https://www.adobe.com/learn/photoshop/web/make-precise-selections-in-select-mask)、[设备与云端处理](https://helpx.adobe.com/photoshop/desktop/make-selections/automatic-color-based-selections/improved-select-subject-and-remove-background-results.html)。

本项目借鉴自动选择、观察边缘、人工修正、保留蒙版的工作流。平滑、羽化、扩缩和人工画笔是数值／手动修正；尚未实现 Adobe 的语义 Refine Hair、背景颜色去污染或独立 trimap matting 算法。

## 候选比较

| 候选 | 适用点 | 限制与选择 |
| --- | --- | --- |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) | 高分辨率前景分割；提供不同任务与 Lite 权重；MIT | 本次采用 Lite FP32，CPU ONNX 可运行，保留连续概率边缘；不是保证准确的物理透明度估计 |
| [rembg](https://github.com/danielgatis/rembg) / U2Net | 成熟的背景移除封装、多种模型、可用作服务或 Python 管道 | rembg 本身不是分割算法；模型许可证须分别检查。把 Python / 多模型包塞入桌面程序会明显增加体积，本次不打包 |
| [SAM](https://github.com/facebookresearch/segment-anything) | 点击／框选交互式对象分割；Apache 2.0 | 普通对象掩码不等于发丝和半透明 alpha。若进一步加入 matting 模型，维护和资源需求增加，本次暂未接入 |
| [Matte Anything](https://github.com/hustvl/Matte-Anything) / [Matting Anything](https://github.com/SHI-Labs/Matting-Anything) | 结合交互式分割和 alpha matting 的研究路线 | 需要额外模型、运行链与真实对照验证，适合作为后续细发丝精修研究，不作为本次已完成功能 |
| [BRIA RMBG 2.0](https://github.com/Bria-AI/RMBG-2.0) | 专用背景移除模型 | 官方权重使用非商业许可，商业使用需要协议。此次没有选择，避免把研究许可当成通用商用许可 |

## 实际接入

采用 [studioludens/birefnet-lite-512](https://huggingface.co/studioludens/birefnet-lite-512)，固定 revision `4a3c40c36c94093cc1e724d9ea428b8fa4b57dc7` 的 `onnx/model.onnx`。它是 MIT 的 BiRefNet Lite 512×512 社区再导出，使用前校验并在本机实际推理。

- FP32，191,877,254 字节（182.99 MiB）；SHA-256：`1cb0fb360dadd15af77c639085d77a9df67db0c64315560c3de005f676345ac2`。
- RGB 缩放至 512×512，除以 255，用 ImageNet mean/std 标准化，NCHW Float32 输入。输出必须为 1×1×512×512 Float32 logits，经 sigmoid 得到软蒙版，不二值化。
- 模型权重随主程序内嵌，Worker 执行推理。当前运行策略探测 WebGPU，初始化或推理失败时回退 CPU，也可在设置中强制 CPU；生产资源只分发一份共用 WASM。Windows WebView2 与浏览器使用相同生产推理实现。
- 模型作为应用内置资源读取，尺寸和 SHA-256 不符拒绝推理；构建前后校验相同固定权重。首次使用不需要网络，也不建立模型 IndexedDB 副本。取消会中止资源读取和推理；读取失败不会悄悄改用颜色算法。
- 所有图像像素留在本机。自动抠图的模型资源与推理均在本机，不上传图片。
- 原始图层按文档坐标和祖先变换生成实际图像；工具的 composite 读取真实可见合成；拒绝空白伪造图像和丢失资源。
- 原图／画布变动时拒绝旧推理结果。蒙版捕获原始变换与尺寸，跟随图层移动、旋转和缩放；保持原始像素格，调整画布不复制大蒙版。
- 精修在完整文档坐标执行后缩放预览，应用时使用同一计算。画笔可按笔撤销，最多 20,000 采样点。工作台最多支持 4,000 万像素；大图内存／CPU 仍是实际限制。

## 可靠性与质量边界

单元测试覆盖软边缘、坐标、变换、资源、过期结果、失败、取消和撤销。集成验收入口见 [integration](../../integration/README.md)。这些检查证明实际链路可运行，不能证明所有图片都精准。

复杂背景、运动模糊、细发丝、反光、透明玻璃与多个主体可能需要人工修正。蒙版概率不等于物理 alpha；本次不提供专业背景去污染。原始图层已在画布外的部分无法从当前文档范围的蒙版恢复。用户可观察黑、白、灰与透明背景，手动补回／擦除，然后保留可继续编辑的图层蒙版。

推理运行库分发依据：[ONNX Runtime Web 部署说明](https://onnxruntime.ai/docs/tutorials/web/deploy.html)。质量评估仍需要带真值的多场景测试集和用户照片，不能仅用模型项目的论文成绩替代本机效果验证。

## 1024 导出未采用的原因

本机真实测试发现 onnx-community 的 1024×1024 FP32 导出在 WebAssembly 执行 OrtRun 时返回 `std::bad_alloc`。同一权重用 Python 原生 CPU ONNX Runtime 禁用 arena／memory pattern 后，植物样张可推理，RSS 峰值约 5,282 MiB，超过 WebAssembly 32 位内存空间的实用限制。仅减少线程或模型文件大小不足以解决中间张量开销。因此最终采用固定 512 输入再导出。512 的空间细节低于 1024；非常细的发丝可能需要人工精修。本项目没有复述模型维护者的“与原始精度相同”结论作为本机评估结果。
