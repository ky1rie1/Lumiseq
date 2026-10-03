# 开源编辑器参考

Lumiseq 学习公开编辑器的交互组织与算法方法，原创应用代码采用 MIT。参考项目自身的代码与素材许可证需逐文件确认。

| 项目 | 参考方向 | 实现关系 |
| --- | --- | --- |
| [Pinta](https://github.com/PintaProject/Pinta) | 工具组、选区、历史、裁剪 | 交互参考；当前未复用源码 |
| [Graphite](https://github.com/GraphiteEditor/Graphite) | 工具控制栏、图层和面板布局 | 交互参考；当前未复用图标或源码 |
| [Krita](https://github.com/KDE/krita) | 多边形选择、修饰键、裁剪辅助线 | 行为参考，当前未复制 GPL 代码 |
| [GIMP](https://github.com/GNOME/gimp) | 选区模式、蒙版、无损操作 | 行为参考，当前未复制 GPL 代码 |
| [darktable](https://github.com/darktable-org/darktable) | RAW 模块组织、色彩评估与去雾方法 | 公开方法参考，当前未复制 GPL 代码 |
| [RawTherapee](https://github.com/RawTherapee/RawTherapee) | RAW 工作台、细节处理、色彩管理 | 公开方法与渲染对照，当前未复制 GPL 代码 |

## 当前实现

- 工具元数据与快捷键组织位于 `src/ui/workspaces/edit/editTools.ts`。
- 几何选区、蒙版和裁剪通过现有命令执行。
- [全图去雾](DEHAZE.md)与小波降噪为项目独立实现。
- [色彩对照](COLOR_PARITY.md)使用公开许可明确的 RAW 与发布者渲染；未用色块结果拟合颜色。
- 智能对象滤镜保留参数、原始资源、撤销链与 AI 工具入口。
- 图层操作参考 [Pinta 的图层动作](https://github.com/PintaProject/Pinta/blob/master/Pinta.Core/Actions/LayerActions.cs) 的独立命令组织；递归树、祖先锁定和世界坐标几何由本项目实现。

RAW 参数复用的设计参考 [darktable history stack](https://docs.darktable.org/usermanual/4.2/en/module-reference/utility-modules/lighttable/history-stack/) 的模块选择及白平衡默认排除。Lumiseq 使用自身事务与目标照片资源解析，保留原有撤销及相机数据边界。实现所在的模块见 [架构说明](../ARCHITECTURE.md)。

## 自动影调与细节

2026-10-03 核查 RawTherapee `dev` 提交 `94c3096e706d89a2325415d56af188ca0228ce34`：

- [`getAutoExp`](https://github.com/RawTherapee/RawTherapee/blob/94c3096e706d89a2325415d56af188ca0228ce34/rtengine/improcfun.cc) 的分布统计及影调联动用于行为研究；Lumiseq 自行实现浮点六参数有界搜索，不使用其源代码。
- [锐化模块](https://github.com/RawTherapee/RawTherapee/blob/94c3096e706d89a2325415d56af188ca0228ce34/rtengine/ipsharpen.cc) 的 Gaussian、阈值和光晕控制作为质量参考。
- [darktable local contrast](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/local-contrast/) 与 [contrast equalizer](https://docs.darktable.org/usermanual/development/en/module-reference/processing-modules/contrast-equalizer/) 提供亮度、尺度和保边处理参考。Lumiseq 的新版滤波不是这两个模块的移植。
- [Guided Image Filtering](https://people.csail.mit.edu/kaiming/eccv10/index.html) 提供导向滤波数学模型；本项目以完整归一化 Gaussian 均值替代 box 均值，CPU、GPU、原生实现保持同一约定。

### 本轮算法检查范围

| 参数组 | 当前实现和检查 | 仍需真实场景确认 |
| --- | --- | --- |
| 曝光、黑白场、阴影高光、对比度 | 版本化浮点单调影调；signed/HDR、灰阶和后端回归 | 不同光照下的自动目标与审美偏好 |
| 白平衡、曲线、HSL、饱和度 | 现有生产顺序；修复 CPU HSL 后端缺口；自动调整复用并保留意图 | 相机配置与真实色卡标定 |
| 纹理、清晰度、锐化 | 新版完整滤波、逐阶段计算、星点与新增暗晕控制；有效增强／平滑、旋转及原尺寸 Sony 抽查 | 更多星点形态、镜头、极端参数与高 ISO |
| 去雾 | 保留全图暗通道／导向滤波，现有质量回归 | 夜景、逆光和彩色雾的色偏 |
| 亮度／色彩降噪 | 保留三层 B3 小波与全图噪声统计，现有 signed/HDR 和空间回归 | 机型／ISO 噪声模型与星点存活率 |
| 暗角、局部蒙版 | 实际蒙版像素、全图坐标；候选影调按生产顺序复算 | 多重蒙版和交付画面的视觉检查 |

数学回归、单张照片抽查和发布者色卡渲染对照分别提供不同证据；任何一项都不代表已经达到所有相机的 Camera Raw 质量。详细精度、样本与边界见 [RAW 质量](../RAW_QUALITY.md)。

## 授权原则

参考行为与复制代码是不同的使用方式。新增第三方代码时检查具体文件许可证、版权头、依赖和再分发义务；保存完整通知，并更新 [第三方声明](../../THIRD_PARTY_NOTICES.md)。上表是本项目既有研究记录，不代替未来复用时的许可证核对。
