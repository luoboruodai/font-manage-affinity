## Windows preview / Windows 预览

- 包含 1.1.0 的家族字款卡片、默认易读字款、可变字体信息 tag 和统一悬停热区。Includes the 1.1.0 family-grouped cards, readable default faces, variable-font tags and centered hover targets.
- 自包含单文件（无需安装 .NET）；解压后双击 `install-windows.bat`，在 PATH 有 Node.js 时安装到 `%LOCALAPPDATA%\Font Manage` 并创建桌面快捷方式。WebView2 运行时随当前 Windows 10/11 提供。Self-contained single-file build; double-click `install-windows.bat` with Node.js on PATH. WebView2 ships with current Windows 10/11.
- **已验证 / Verified**：字体引擎与外壳在真实 Windows（GitHub Actions windows-latest）通过冒烟：字体枚举、Arial/微软雅黑核心覆盖断言、预览 PNG 解码、Node 单元测试与双击安装器检查。
- **未验证 / Not verified**：Affinity for Windows 的本机 MCP 连接与真实字体应用尚未实测；首次使用请先在测试文档中确认“应用字体”。The Affinity link and real font application on Windows have not been verified yet.
- 引擎预览按字形逐个绘制、不经过系统回退；复杂文字 shaping 与 macOS CoreText 引擎存在细微差异，覆盖判定规则一致。