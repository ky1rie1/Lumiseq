# 内置抠图权重

`birefnet-lite-512.onnx` 是与 `model.json` 固定大小和 SHA-256 一致的 MIT BiRefNet Lite 512 FP32 导出。来源 URL／revision 写在该清单中。

构建开始时 `scripts/prepare-cutout-model.mjs` 校验源权重；缺失时只会尝试复制 `%LOCALAPPDATA%/AI-Creative-Studio/cutout-validation/birefnet-lite-512-verified.onnx` 中相同校验通过的文件，否则明确停止，提示准备指定权重。构建不会悄悄下载／替换模型。源权重没有打包成 JavaScript/base64，由 Vite 发出单个二进制资源，再由 Tauri 压缩内嵌。

运行 EXE 无需携带此目录、模型旁文件或验证缓存；模型资源从程序读取，每次初始化前验证 SHA-256。新克隆的源码仓库可运行 `npm run model:download` 显式下载清单指定的版本；脚本校验大小和 SHA-256 后才将文件放入此目录。权重不提交到 Git。许可来源见根目录 `THIRD_PARTY_NOTICES.md`。
