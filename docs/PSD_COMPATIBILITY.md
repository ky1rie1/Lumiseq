# PSD compatibility / PSD 兼容说明

影序可以将图像编辑文档保存为分层 `.psd`。Photoshop 可读取标准合成图与独立的像素图层；影序的 AI 对话、模型、操作记录和专有编辑状态保存在 PSD 的私有图像资源块中，不会成为 Photoshop 中的可见图层。用影序重新打开该 PSD 时，会优先恢复完整的影序项目。

Yingxu can save an edit document as a layered `.psd`. Photoshop reads the standard composite and separate pixel layers. Yingxu stores its AI conversation, model, operation log, and native editing state in a private image resource, not a visible Photoshop layer. Reopening the same PSD in Yingxu restores the native project.

| Content / 内容 | Photoshop | Yingxu / 影序 |
| --- | --- | --- |
| Composite / 合成图 | Visible / 可见 | Restored / 可恢复 |
| Raster layers / 像素图层 | Separate, paintable / 独立可编辑 | Original native layers / 原生图层 |
| Text / 文字 | Rasterized pixel layer / 栅格化图层 | Original editable text / 原生可编辑文字 |
| AI history / AI 历史 | No visible UI or layer / 不显示在画布与图层中 | Conversation, provider, model, operations / 对话、服务商、模型、操作 |
| Native masks and settings / 专有蒙版与设置 | Pixel appearance only / 仅显示像素结果 | Original editable state / 原始可编辑状态 |

PSD 写出对目前无法忠实呈现为独立像素图层的调整图层和 RAW 智能对象会报错，不会默默丢失；请改用 `.aistudio`。复杂 Photoshop PSD 的外部导入会转换为普通像素图层，组、可编辑文字、智能对象和调整参数不保证保留。当前仅支持导入 8 位图层数据。

PSD export rejects adjustment layers and RAW smart objects that cannot currently be represented faithfully as separate pixel layers. Use `.aistudio` for these projects. Importing an unrelated complex Photoshop PSD converts supported 8-bit content to raster layers; groups, live text, smart objects, and adjustment parameters are not guaranteed to survive as native objects.
