## Font Manage 0.4.0-alpha — Windows 预览 / Windows preview

- 自包含单文件（无需安装 .NET），解压后在 PATH 有 Node.js 的前提下运行 `node scripts/start.cjs`。WebView2 运行时随当前 Windows 10/11 提供。
- Self-contained single-file build (no .NET install needed); run `node scripts/start.cjs` with Node.js on PATH. WebView2 runtime ships with current Windows 10/11.
- **已验证 / Verified**：字体引擎与外壳在真实 Windows（GitHub Actions windows-latest）通过冒烟：字体枚举、Arial/微软雅黑核心覆盖断言、预览 PNG 解码、Node 单元测试。
- **未验证 / Not verified**：Affinity for Windows 的本机 MCP 连接与真实字体应用尚未实测；首次使用请先在测试文档中确认“应用字体”。
- 引擎预览按字形逐个绘制、不经过系统回退；复杂文字 shaping 与 macOS CoreText 引擎存在细微差异，覆盖判定规则一致。
