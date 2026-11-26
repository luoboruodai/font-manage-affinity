# Changelog

## 1.1.1 (2026-11-26)

- Fixed the Windows preview zip layout: the bundle now keeps `dist/win/` intact and CI verifies the packaged engine, shell and root installer after archiving. 修复 Windows 预览包目录层级，并在 CI 中回读校验。

## 1.1.0 (2026-11-26)

- Family-grouped font cards: one card per family with a compact style dropdown; Regular/Normal is the default, while exact searches and host selections keep their exact PostScript face. 字体家族合并卡片，默认易读字款；精确搜索仍保持精确字款。
- Variable fonts now show a blue “可变字体” tag below the preview instead of taking space in the card heading. 可变字体改在样本下方显示蓝色信息 tag。
- Hover targets are now square and centered: 28×28 px in navigation and 26×26 px in cards, with a 2 px gap between card actions. 悬停热区统一为正方形并居中。
- Affinity's local MCP endpoint now uses IPv4 `127.0.0.1:6767`, matching the current host listener. Affinity 本机接口按当前宿主监听地址改用 IPv4。
- Verified locally: 34/34 unit tests, 12/12 Chromium UI tests, successful build, and a real Affinity apply check (`42dotSans-Bold`). 本机验证：34/34 单元、12/12 UI、构建与真实 Affinity 应用检查通过。

## 1.0.0 (2026-11-19)

- Unified release: macOS stable (fully verified on the maintainer's machine, including a real Affinity apply run) and Windows preview (engine/shell/installer verified on real Windows CI; Affinity link on Windows not yet verified).
- Both bundles ship a double-click installer: `install-macos.command` (macOS) and `install-windows.bat` (Windows).
- 统一发布：macOS 正式版（本机完整验证，含真实 Affinity 应用）与 Windows 预览版（引擎/外壳/安装器经真实 Windows CI 验证；Affinity 连接未实测），均附双击安装脚本。

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
