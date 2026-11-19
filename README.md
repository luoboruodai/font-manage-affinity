# Font Manage

A compact font manager for **Affinity on macOS**: browse real CoreText-rendered previews, filter by actual script coverage, and apply the selected font safely to the current text selection.

一款面向 **macOS Affinity** 的紧凑字体管理工具：真实 CoreText 字体预览、按实际文字系统覆盖筛选、安全地把选中字款应用到当前文本对象。

![Font Manage workspace](docs/images/workspace.png)

## What it does / 功能

- **Real previews, not font names / 真实预览** — every row is rendered by the system CoreText stack in the target font; missing glyphs, blocked fallbacks and partial coverage are shown as tappable badges. 每行都由 CoreText 按目标字款真实绘制；缺字、阻止回退、部分覆盖以小胶囊提示，点击查看详情。
- **Script coverage filtering / 按文字系统筛选** — Latin, Simplified Chinese, Traditional Chinese, Japanese, Korean, digits and symbols, each with its own core character set. Fonts below the core-coverage threshold are excluded; partial coverage stays visible. 西文、简体、繁体、日文、韩文、数字、符号各有核心字符集；核心覆盖不足默认排除，部分覆盖保留。
- **Custom preview text per type / 按类型自定义样例** — your text is stored per type and cleared back to the type default. 自定义样例按类型保存，清空即恢复默认。
- **Favorites, groups, recents / 收藏、分组、最近** — groups are managed in a centered modal dialog. 分组以居中弹窗创建与重命名。
- **Safe apply / 安全应用** — applies to the current Affinity text selection through Affinity's official local MCP bridge, verifying document identity, editability and the resulting PostScript name; undoable in Affinity. 通过 Affinity 官方本机接口应用到当前文本选区，应用前后核对文档与字体名，可在 Affinity 中撤销。

## Requirements / 环境要求

- **macOS only / 仅支持 macOS**（当前版本；**Windows 暂不支持**）。
- Affinity (v3) with its local MCP scripting interface enabled / 启用本机 MCP 脚本接口的 Affinity 3。
- Node.js available on `PATH`（应用包不内置 Node 运行时）。

## Install / 安装

1. Download `Font-Manage-<version>-macos.zip` from the [latest release](../../releases/latest) and unzip. 从最新 Release 下载并解压。
2. The app is ad-hoc signed only; on first launch, right-click → **Open** (or run `xattr -dr com.apple.quarantine "Font Manage.app"`). 应用未做公证，首次打开请右键选择“打开”。
3. Open `Font Manage.app`. It starts its local service, connects to Affinity automatically and reuses a single instance. 打开应用即可自动连接 Affinity，重复打开复用同一实例。

## Build from source / 从源码构建

```sh
npm ci
npm run check   # syntax checks
npm test        # unit tests
npm run build   # builds dist/Font Manage.app
npm run test:ui # Chromium UI/integration tests (host disabled)
```

The build compiles the Swift font engine and the WKWebView shell and assembles a self-contained `.app` with web assets and server code. 构建会编译 Swift 字体引擎与 WKWebView 外壳，并组装为自包含 `.app`。

## Notes / 说明

- Data (favorites, groups, settings) is stored in `~/Library/Application Support/Font Manage/`. 收藏、分组与设置保存在本机应用支持目录。
- The workspace only listens on `127.0.0.1`; Affinity's MCP endpoint is loopback-only. 工作区仅监听本机回环地址。
- UI and interaction study of HL_Fontory (a proprietary AE/CEP extension) informed the layout only; all code, icons and engine are an independent implementation. HL_Fontory 仅作布局与交互参考，代码、图标与引擎均为独立实现。

## License / 许可

MIT — see [LICENSE](LICENSE).
