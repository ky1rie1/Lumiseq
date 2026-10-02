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

## 授权原则

参考行为与复制代码是不同的使用方式。新增第三方代码时检查具体文件许可证、版权头、依赖和再分发义务；保存完整通知，并更新 [第三方声明](../../THIRD_PARTY_NOTICES.md)。上表是本项目既有研究记录，不代替未来复用时的许可证核对。
