#!/bin/bash
# Font Manage 安装器（macOS）— 双击运行：安装到 /Applications、去隔离属性、创建桌面快捷方式并启动。
set -u
cd "$(dirname "$0")"
APP="Font Manage.app"
SRC=""
for candidate in "./$APP" "../dist/$APP" "dist/$APP"; do
  if [ -d "$candidate" ]; then SRC="$candidate"; break; fi
done
say() { echo "$1"; }
if [ -z "$SRC" ]; then
  say "未找到 $APP。请把本脚本与 Font Manage.app 放在同一文件夹后双击运行。"
  read -r -p "按回车退出…" _; exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  say "未找到 Node.js。Font Manage 需要 Node.js（https://nodejs.org，LTS 即可），安装后重新双击本脚本。"
  read -r -p "按回车退出…" _; exit 1
fi
if [ ! -d "/Applications/Affinity.app" ]; then
  say "提示：未在 /Applications 检测到 Affinity。仍可继续安装，但使用前请安装 Affinity 3 并启用其本机 MCP 脚本接口。"
fi
xattr -dr com.apple.quarantine "$SRC" 2>/dev/null || true
DEST="/Applications/$APP"
if [ -d "$DEST" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S)
  mv "$DEST" "$HOME/.Trash/Font Manage-$STAMP.app" 2>/dev/null || { say "无法替换旧版本，请手动删除 $DEST 后重试。"; read -r -p "按回车退出…" _; exit 1; }
  say "旧版本已移入废纸篓。"
fi
cp -R "$SRC" "$DEST" || { say "复制到 /Applications 失败（可能需要管理员权限）。"; read -r -p "按回车退出…" _; exit 1; }
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true
ln -sfn "$DEST" "$HOME/Desktop/$APP"
say ""
say "安装完成："
say "  应用：$DEST"
say "  桌面快捷方式：$HOME/Desktop/$APP"
say "  数据目录：$HOME/Library/Application Support/Font Manage/"
say ""
say "首次使用：打开应用后会自动连接 Affinity；如连接失败，请在 Affinity 设置中启用本机 MCP 脚本接口。"
open "$DEST" 2>/dev/null || true
read -r -p "按回车关闭窗口…" _
