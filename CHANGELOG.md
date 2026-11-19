# Changelog

## 0.3.2 (2026-11-19)

- Split Chinese into Simplified (`zh-Hans`) and Traditional (`zh-Hant`) types with independent core/regular character sets and thresholds; fonts may carry both labels. 中文拆分为简体/繁体独立类型，多标签。
- Core-coverage exclusion with a diagnostics API; partial coverage stays visible with per-font coverage badges. 核心覆盖不足默认排除，提供诊断接口；部分覆盖保留。
- HL_Fontory-inspired compact UI: tighter header/nav, full-width preview row with type select and reset, collapsible preview bar, card spacing, pill diagnostics, settings popup, centered group modal, toast messages. 参考 HL_Fontory 的紧凑界面与弹窗体系。
- Per-type custom preview text with migration from the old global value. 自定义样例按类型保存。
- One-click launch, single instance, auto-connect/reconnect to Affinity via the official local MCP bridge; safe apply with selection identity and undo. 一键启动、自动连接与安全应用。

## 0.1–0.3.1 (earlier, private iterations)

- Compact workspace with real CoreText previews, virtual list with dynamic row heights, favorites/groups persistence, one-click launch, auto-connect, Korean/Hangul support, simplified/traditional split groundwork. 早期私有迭代：真实预览、虚拟列表、持久化、自动连接与简繁分类基础。
