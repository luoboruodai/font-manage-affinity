# macOS 字体预览助手

`FontEngine.swift` 只读取当前进程可用的 CoreText 字体，通过 JSON Lines 返回目录和预览，无需 npm 包或字体副本。`config/coverage.json` 定义七类文字系统（西文、简体中文、繁体中文、日文、韩文、数字、符号）的核心字符、常规字符和覆盖阈值。

```sh
swiftc -O -framework AppKit -framework CoreText native/FontEngine.swift -o private/validation/font-engine-test
printf '%s\n' '{"seq":1,"op":"preview","id":"ArialMT","text":"Affinity 中文😀","size":28,"width":360,"scale":2,"mode":"fit"}' | private/validation/font-engine-test
```

- `{"op":"fonts"}` 返回字款、家族、分类、固定语言覆盖（含 `zh-Hans`/`zh-Hant` 多标签）、覆盖率/缺失核心字符/排除原因、重复文件数及可变实例诊断。
- `{"op":"preview","id":"ArialMT","text":"Affinity","size":28,"width":360,"scale":2,"mode":"fit"}` 返回 PNG Base64、像素和布局宽高、行数、实际字号、缺字、回退及加载诊断。
- `mode:"fit"` 先按实际字宽等比缩小，最低 18 pt 后换行；`mode:"wrap"` 直接按目标宽度换行。显式换行、长单词、CJK 和 Hangul 按真实字宽排版。
- 预览只绘制目标 PostScript 名和可核实文件一致的字形。系统回退区域留空，`missing` 报告缺失字符簇，`fallback` 报告系统尝试使用的字款，不把替代字体冒充目标字体。
- 极大文本以较低栅格分辨率保留全部行，布局和换行不变；返回 `rasterScale`，网页按布局尺寸显示。

本机验证：2,228 个字款、七类覆盖（简繁独立且多标签）、韩文 Hangul、核心排除与部分覆盖、长单词、显式换行、18 pt 后换行、500 字符簇边界和回退阻断均通过。详见 `tests/font-engine.test.cjs` 与 `private/validation/v04/unit.log`。

## 桌面窗口

```sh
node scripts/build-workspace.cjs
open 'dist/Font Manage.app'
```

应用包含 `Contents/Resources/app` 下的 JS、网页、配置和 Swift 二进制，启动脚本使用包内相对路径。运行需要本机 Node 位于常见 PATH 中；不复制 Node 或字体。收藏与设置写入 `~/Library/Application Support/Font Manage/`，窗口尺寸位置由 AppKit 保存。关闭窗口会停止本次启动的服务。
