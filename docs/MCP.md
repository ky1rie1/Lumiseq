# AI / MCP 操作接口

Lumiseq 的规范工具位于 `src/ai/tools/`。内置 AI 和外部 MCP 调用这些工具，通过现有命令总线修改活动文档。

## 外部连接

先在设置中的外部工具页面启用 MCP 服务。它使用带 Bearer Token 的本机环回 HTTP 接口；默认首选端口为 18280，实际端口以设置页面为准。

### stdio 适配器

`bin/studio-mcp.js` 将 MCP 请求转发到运行中的桌面程序。配置时填写真实绝对路径、端口和令牌：

```json
{
  "mcpServers": {
    "lumiseq": {
      "command": "node",
      "args": ["C:/path/to/lumiseq/bin/studio-mcp.js"],
      "env": {
        "STUDIO_MCP_ENDPOINT": "http://127.0.0.1:18280/mcp",
        "STUDIO_AUTH_TOKEN": "<copy-token-from-settings>"
      }
    }
  }
}
```

适配器在宿主未连接时提供有限的发现信息，编辑调用需要桌面程序在线。实际完整工具清单以连接后的 `tools/list` 为准。

### HTTP

支持 Streamable HTTP 的客户端可直接连接 `http://127.0.0.1:<port>/mcp`，请求带 `Authorization: Bearer <token>`。服务默认关闭，限制为本机连接。不要把包含真实令牌的客户端配置提交到仓库。

首次启动生成独立随机令牌；旧版公开默认令牌会被替换，已有客户端需要从设置重新复制。外部权限单独生效：只读允许查询、拒绝修改；询问模式在修改前弹出确认；自动／完全模式允许普通编辑，危险操作仍需确认。未安装确认处理器时拒绝需要确认的调用。

内置 AI 的编辑记录按任务显式归属；等待 AI 时产生的手动修改保留自己的历史。任务之后已有其他编辑时，整组撤销会拒绝并说明原因；先撤销后续编辑即可再撤销该任务。取消也遵循这一保护规则，无法安全回退的内容会保留并显示提示。

## 常用工具

| MCP 名称 | 用途 |
| --- | --- |
| `studio_get_workspace` | 工作区、打开文档与活动文档 |
| `studio_get_document_context` | 文档、图层、参数和选区上下文 |
| `studio_get_preview` | 当前文档预览 |
| `studio_inspect_document` | 显式文档的整图或区域观察，附版本与坐标证据 |
| `studio_inspect_region` | 原文档坐标的区域观察或 1:1 细节 |
| `studio_get_observation` | 按观察 ID 读取保留的图像或证据 |
| `studio_get_develop_parameter_specs` | RAW 参数范围 |
| `studio_auto_tone` | 新版联动八项自然影调及色彩，旧版保留六项影调，一步撤销，返回精度及检查证据 |
| `studio_edit_upgrade_precision` | 创建并激活独立 32F linear-sRGB 图像工程副本，保留原工程 |
| `studio_edit_auto_color` | 高精度图像工程的 autoContrast / autoTone / autoColor 调整图层，一步撤销 |
| `studio_edit_raw_smart_object` | open 打开原始 RAW 关联调色副本；apply 将参数应用回原图像工程并激活 |
| `studio_develop_semantic_auto_color` | 使用已有整图及原尺寸区域证据显式提出八项自然色彩候选；不调用模型 |
| `studio_upgrade_rendering` | 显式照片 ID 创建新版调色副本，保留 RAW 解码及坐标 |
| `studio_reset_group` | 重置 basic / color / curves / detail / optics 参数组，一步撤销 |
| `studio_develop_set_parameter` | 设置 RAW 参数，包括细节与 HSL |
| `studio_set_curves` | 设置四个归一化曲线通道 |
| `studio_copy_settings` | 从指定照片复制参数到会话剪贴板 |
| `studio_paste_settings` | 向指定照片按模块粘贴参数，一步撤销 |
| `studio_create_smart_object` | 图层转为智能对象 |
| `studio_add_smart_filter` | 添加智能滤镜 |
| `studio_manage_smart_filter` | 修改、启停、删除或重排滤镜 |
| `studio_transform` | 图层位置、缩放与旋转 |
| `studio_duplicate_layer` | 递归复制图层或分组，创建独立编辑数据 |
| `studio_set_layer_locked` | 设置图层锁定，父组锁定对子图层有效 |
| `studio_align_layer` | 按实际变换后边界对齐到画布 |
| `studio_flip_layer` | 围绕显示中心水平或垂直翻转 |
| `studio_undo` / `studio_redo` | 撤销与重做 |

完整名称映射位于 `src/ai/tools/schemaAdapters/MCPSchemaAdapter.ts`，工具参数由注册表生成。不要依赖历史文档中的旧别名作为唯一接口。

自动影调成功只表示参数已提交。先检查整图，再用同坐标原尺寸观察复核星点、人脸、边缘及高光；返回的 `detailVerification: "native-region-required"` 明确要求检查最终空间处理结果。旧工程的渲染版本默认是 1；`studio_upgrade_rendering` 创建独立版本 2 副本，不等同于会改变镜头坐标的 RAW 解码升级。

新版自然自动色彩只调整 `exposure`、`contrast`、`highlights`、`shadows`、`whites`、`blacks`、`saturation`、`vibrance`；自动白平衡独立。`studio_edit_auto_color` 要求版本 2、32F、linear-sRGB：`autoContrast` 使用共同黑白锚点，`autoTone` 使用各通道曲线，`autoColor` 只在可靠中性证据支持时校色，否则明确退回对比度策略。它们创建可撤销调整图层，保留原始像素及透明度。

精度升级及 RAW 智能对象 open/apply 会更新活动文档和工作区；后续调用使用返回的 `changedDocumentId`，先重新观察该文档。open 后等待 RAW 解码 ready；apply 是一次可撤销的参数更新，不栅格化原始素材。临时 RAW 路径在打开失败或调色副本关闭后清理，原始 RAW Blob 仍保留；这不意味着已有调色 JSON 格式自动成为可移植封装。

语义候选先获取当前完整整图，再获取高光、肤色、噪声、纹理及主体的原尺寸 1:1、非近似区域观察。提交当前 `sourceId`、`documentRevision`、整图 `overviewObservationId`、区域观察 ID 及原文档像素坐标，`parameters` 必须恰好包含上述八项绝对值。过期源或版本拒绝提交；视觉缺失或失败可传 `visionStatus: "failed"` 省略参数，保留有效本地结果。候选舍入后必须同时通过安全检查并优于本地及中性参数；否则保留本地结果。观察和统计检查不证明应用后的空间细节，仍需复核最终整图及原尺寸区域。

图层服务使用显式的 `documentId`、`layerId`。锁定错误返回 `LAYER_LOCKED`；修改子图层前必须解锁其父组。内容编辑、删除和重新归组遵守相同策略，可见性与只读查询仍可使用。复制只共享不可变素材引用，副本参数、图层及蒙版标识独立；对齐／翻转各产生一个可撤销命令。

## 大图与细节观察

先通过 `studio_get_workspace` 取得真实 `documentId`，再调用 `studio_inspect_document`：

```json
{
  "documentId": "actual-document-id",
  "request": { "mode": "overview" }
}
```

默认整图长边为 1024 px。返回的 MCP `image` 内容块是真实渲染结果，独立的文本证据包含 `observationId`、`revision`、源尺寸、实际区域、输出尺寸及 `pixelToDocument` 仿射映射。观察不改变用户的画布缩放或平移。缩略图因舍入可能具有不同的 X／Y 比例，必须使用返回映射。

需要检查细线、文字或蒙版边缘时，从整图定位到原文档坐标，调用 `studio_inspect_region`：

```json
{
  "documentId": "actual-document-id",
  "mode": "detail",
  "region": { "x": 1500, "y": 1000, "width": 1200, "height": 800 },
  "expectedRevision": "revision-from-overview"
}
```

`detail` 保持 1:1，每边最多 1536 px，过大的区域须分块；`region` 可缩小到指定长边。坐标为方向校正后的原文档像素，区域会向外取整并裁到文档边界。不要从缩略图裁切来替代原尺寸观察。局部修改还应检查相邻边缘，修改前后使用相同的文档坐标。

`variant: "current"` 为当前完整合成。RAW 的 `original` 为中性配方；图像编辑文档不提供单一“原图”合成，须在写入前保留当前合成作为对照。颜色证据标记为 sRGB、近似显示观察；精确 RGB 使用现有编辑器像素取样工具，不能从 JPEG 或模型描述推断数值。

观察缓存有数量及字节上限。文档变化、缓存淘汰或服务关闭后，重新观察；`studio_get_observation` 的 `metadataOnly: true` 只返回证据。`studio://observation/<id>` 为当前保留观察的 JSON 证据资源，`studio://preview/active` 为活动文档图像资源。`get_preview` 保留旧调用，但新客户端应使用显式文档观察。

图像通过各 Provider 的多模态通道传输，本地 Agent 只在实际探测到图像接口时接收。CLI 支持图片参数不等于当前模型已通过视觉理解验收；不支持时须报告能力限制，视觉后备连接遵守现有上传授权。过大的请求会明确拒绝，不能静默删除图像或改变坐标对应关系。

## 操作指南与按需发现

`studio_read_guide` 读取 `studio://guide/operations` 或 `studio://workflow/precise`、`photo`、`local-detail`、`layout`。相同内容也可通过 MCP resources 读取，包含真实工具目录、单位、目标 ID、前置条件、锁定、撤销和错误恢复说明。

```json
{
  "uri": "studio://workflow/local-detail"
}
```

`studio_discover_tools` 可按 `groups` 或 `names` 查询操作元数据。应用内运行时先提供任务相关的工具组；`expand: true` 将发现的当前工作区工具加入后续计划请求。外部 MCP 客户端仍可通过 `tools/list` 获取完整目录，调用相同规范工具。

```json
{
  "groups": ["local"],
  "expand": true
}
```

局部操作须先确认真实目标、选区或蒙版及原尺寸证据。一个无关区域的细看不能授权修改另一区域；旧版本证据必须刷新。未知修改范围会保持待验证状态，不能以工具成功冒充精细编辑完成。

## 创作方案与偏好

`studio_build_creative_brief` 将用户目标与文档内容整理为摄影或排版约束；`taskKind` 可明确指定任务类型。摄影关注主体、肤色、白平衡和细节，排版关注准确文案、层级、字体、对齐和留白。缺少关键文案时需要补充，不能擅自编造。

`studio_create_candidates` 接受 `runId`、`prompt` 和一至两个 `plans`。每个方案包含 `label`、`reason` 和规范操作 `operations`；预览在独立文档和历史中执行，原稿不变。例：

```json
{
  "runId": "poster-exploration",
  "prompt": "保留原图，添加标题“LUMISEQ”",
  "plans": [{
    "label": "清晰标题",
    "reason": "通过对齐和留白建立层级",
    "operations": [
      {"name": "edit_create_text_layer", "args": {"text": "LUMISEQ", "fontSize": 64, "x": 100, "y": 100}, "ref": "title"},
      {"name": "edit_rename_layer", "args": {"layerId": "$title", "newName": "Headline"}}
    ]
  }]
}
```

`ref` 为新建对象的符号名，后续 ID 参数可用 `$title`；普通文字中的 `$10` 保持字面值。方案仅支持可重放的规范图层／调色操作，保存、导出、外部生成以及不受支持的资源操作会拒绝。

局部精修或明确限定目标／区域的任务暂不支持候选探索，会返回 `candidate_scope_unsupported`，应使用普通操作流程取得原尺寸证据并执行范围校验。预览操作、观察图片和接受重放计入同一任务预算；生成预览前检查并预留接受一个方案所需的操作额度。

`studio_list_candidates` 查询本次方案及原稿预览。`studio_choose_candidate` 使用返回的 `candidateId` 接受方案，重新检查原稿版本、当前权限与锁定，再重放相同命令；`studio_discard_candidate` 放弃候选。选择与放弃需要真实用户确认，模型传入 `userConfirmed` 或 `userApproved` 不能代替确认。原稿发生变化后应重新生成候选。

应用内接受过程可以停止，并与其他活动任务互斥；原任务预算和总时限继续生效，等待选择不会重置时限。用户选择与技术复核分别记录，存在文字溢出等问题时结果仍为部分完成。参考图也消耗任务图片额度，保留的参考像素与来源参与独立复核。

`studio_get_taste_preferences` 按 `domain: "photo" | "layout"` 读取偏好。`studio_save_taste_preference` 的 `action` 为 `save`、`edit`、`remove` 或 `clear`，保存／编辑使用 `text`，编辑／删除使用 `id`。写入同样需要用户确认；AI 评价不会自动保存，技术参数指令也不作为审美偏好。界面中的风格反馈与设置共用这一偏好存储。

## 调色曲线与参数复用

新增曲线和复制／粘贴工具使用明确的 `documentId`，与 UI 调用同一操作服务。`studio_set_curves` 的 `curves` 包含 `rgb`、`red`、`green`、`blue` 四个通道，每个通道至少两个 `{x,y}` 点；坐标为 0–1，X 严格递增，首尾 X 为 0 和 1。界面中的 0–255 坐标映射到同一归一化数据，保存与原生导出沿用现有插值。

先调用 `studio_copy_settings`，参数 `{ "documentId": "source-document-id" }`。复制不修改工程，也不产生历史。然后调用 `studio_paste_settings`：

```json
{
  "documentId": "target-document-id",
  "groups": ["basic", "color", "curves"],
  "includeWB": false
}
```

可选模块为 `basic`（基础影调）、`color`（色彩与质感）、`curves`、`detail`（锐化降噪）和 `optics`（暗角）。剪贴板只存在于当前应用会话，不写入项目。默认保留目标白平衡、局部蒙版及相机资源。明确启用 `includeWB` 时，自定义模式只传温度／色偏；原照或自动模式使用目标照片自己的数据解析。无法解析时拒绝整次粘贴，不留下部分修改。

## 智能滤镜示例

调用 `studio_add_smart_filter`，参数：

```json
{
  "layerId": "actual-smart-object-layer-id",
  "filterType": "unsharp_mask",
  "settings": { "radius": 2, "amount": 1.2, "threshold": 4 },
  "opacity": 0.8
}
```

类型包括 `gaussian_blur`、`unsharp_mask`、`noise_reduction`。返回值中的 `filterId` 用于后续操作。关闭该滤镜：

```json
{
  "layerId": "actual-smart-object-layer-id",
  "filterId": "id-returned-by-add",
  "action": "toggle",
  "enabled": false
}
```

`update` 使用 `settings` 或 `opacity`；`remove` 删除；`reorder` 必须提供从零开始的 `toIndex`。修改可撤销，滤镜参数保存到原生工程。

智能对象栅格化会烘焙已启用滤镜，保留图层变换、蒙版和混合属性。当前仅图像、绘画和修复图层支持转换；文字、分组及调整图层会返回明确错误，避免生成缺失像素来源的工程。

## 扩展规则

在规范工具注册表中注册工具，提供参数 schema、权限级别、结构化结果和错误。文档变更调用操作服务或命令，不直接修改 Zustand UI 状态。新增 MCP 映射与 Provider adapters 后，验证操作、撤销、保存和重开行为。[架构指南](ARCHITECTURE.md)。
