# Changelog

## 0.3.3 (2026-11-19)

- Double-click installer for macOS: `install-macos.command` checks Node.js, removes quarantine, installs to /Applications, adds a Desktop shortcut and launches. macOS 双击安装脚本。
- Windows installer `install-windows.bat` (in the Windows alpha bundle) installs to %LOCALAPPDATA% and adds a Desktop shortcut; verified on real Windows in CI. Windows 双击安装脚本（CI 实测）。

## 0.4.1-alpha (2026-11-19, Windows preview)

- Bundle now includes the double-click `install-windows.bat` at the zip root; the installer itself is executed and verified on real Windows in CI. 发布包根目录附带双击安装脚本，CI 真实执行验证。

## 0.4.0-alpha (2026-11-19, Windows preview)

- Windows font engine (C#/WPF): same JSON Lines protocol as the macOS engine — enumeration, PostScript names, core-coverage evaluation, fallback-free GlyphRun PNG previews. 与 macOS 引擎同协议的 Windows 字体引擎。
- Windows shell (WebView2): single instance, window placement persistence, close-save handshake. WebView2 外壳。
- Verified on real Windows via GitHub Actions (font enumeration, Arial/YaHei coverage assertions, PNG decode, Node unit tests); Affinity connection on Windows not yet verified. 经真实 Windows CI 验证；Affinity 连接未实测。

## 0.3.2 (2026-11-19)

- Split Chinese into Simplified (`zh-Hans`) and Traditional (`zh-Hant`) types with independent core/regular character sets and thresholds; fonts may carry both labels. 中文拆分为简体/繁体独立类型，多标签。
- Core-coverage exclusion with a diagnostics API; partial coverage stays visible with per-font coverage badges. 核心覆盖不足默认排除，提供诊断接口；部分覆盖保留。
- HL_Fontory-inspired compact UI: tighter header/nav, full-width preview row with type select and reset, collapsible preview bar, card spacing, pill diagnostics, settings popup, centered group modal, toast messages. 参考 HL_Fontory 的紧凑界面与弹窗体系。
- Per-type custom preview text with migration from the old global value. 自定义样例按类型保存。
- One-click launch, single instance, auto-connect/reconnect to Affinity via the official local MCP bridge; safe apply with selection identity and undo. 一键启动、自动连接与安全应用。

## 0.1–0.3.1 (earlier, private iterations)

- Compact workspace with real CoreText previews, virtual list with dynamic row heights, favorites/groups persistence, one-click launch, auto-connect, Korean/Hangul support, simplified/traditional split groundwork. 早期私有迭代：真实预览、虚拟列表、持久化、自动连接与简繁分类基础。
