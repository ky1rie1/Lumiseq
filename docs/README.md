# Lumiseq 文档

从使用、开发到扩展，按目的选择入口。

| 入口 | 内容 |
| --- | --- |
| [项目主页](../README.md) · [English](../README.en.md) | 产品定位、功能、启动方式和当前边界 |
| [开发指南](DEVELOPMENT.md) | 工具链、测试、原生构建和清理 |
| [启动故障排查](TROUBLESHOOTING.md) | Loader、Runtime 与完整便携包 |
| [架构](ARCHITECTURE.md) | 模块职责、数据流和新功能接入路径 |
| [AI / MCP](MCP.md) | 内置工具、外部代理连接和智能滤镜接口 |
| [模型服务](PROVIDERS.md) | 服务配置、能力路由与隐私选项 |
| [PSD 兼容](PSD_COMPATIBILITY.md) | 导入、导出和往返限制 |
| [存储](STORAGE.md) | 工程、偏好、凭据、缓存与恢复数据 |
| [安全与隐私](../SECURITY.md) | 数据边界和问题报告 |
| [GitHub 发布](GITHUB_RELEASE.md) | 首次推送、发布构建和校验清单 |

## 技术方法

- [色彩输出约定](technical/COLOR_OUTPUT.md)
- [色卡测量工具](technical/COLOR_MEASUREMENT.md)
- [公开 RAW 渲染对照](technical/COLOR_PARITY.md)
- [全图去雾](technical/DEHAZE.md)
- [RAW 空间处理与小波降噪](technical/SPATIAL_PROCESSING.md)
- [抠图方法与质量边界](technical/CUTOUT.md)
- [开源编辑器参考](technical/OPEN_SOURCE_REFERENCES.md)
- [编辑能力与模块边界](ARCHITECTURE.md)
- [AI 操作、观察与创作接口](MCP.md)

## 版本说明

[更新记录](../CHANGELOG.md) · [0.9.6 启动与安装](releases/v0.9.6.md) · [0.9.5 AI 面板](releases/v0.9.5.md) · [0.9.4 AI 创作协作](releases/v0.9.4.md) · [0.9.3 工作台与精确编辑](releases/v0.9.3.md) · [0.9.2 发布说明](releases/v0.9.2.md) · [0.9.1 品牌与滤镜](releases/v0.9.1.md) · [0.9.0 色彩与工作台](releases/v0.9.0.md)

本地会话、内部工作笔记、验收记录、运行日志、私人素材和生成缓存不随源码分发。可复运行的测试与集成入口保留在 `tests/` 和 `integration/`，当前功能限制见项目主页和相关技术文档。
