#!/bin/bash
set -e

echo "===== QQ聊天记录导出工具 - macOS 安装 ====="
echo ""

# 检测架构
ARCH=$(uname -m)
echo "系统架构: $ARCH"

# 检测 QQ
QQ_APP="/Applications/QQ.app"
if [ ! -d "$QQ_APP" ]; then
    echo "错误: 未找到 QQ.app，请先安装 QQ"
    exit 1
fi

# 拒绝 App Store 版
PKG_JSON="$QQ_APP/Contents/Resources/app/package.json"
if grep -q '"isMas"' "$PKG_JSON" 2>/dev/null || grep -q '"isAppStore"' "$PKG_JSON" 2>/dev/null; then
    echo "错误: 检测到 App Store 版 QQ，不支持。请从 im.qq.com 下载官网版"
    exit 1
fi

# 检测 LiteLoaderQQNT
LLQQNT_DIR="$HOME/Library/Application Support/LiteLoaderQQNT"
if [ ! -d "$LLQQNT_DIR" ]; then
    echo ""
    echo "未检测到 LiteLoaderQQNT，需要先安装。"
    echo "请参考: https://liteloaderqqnt.github.io/guide/install.html"
    echo ""
    echo "安装完成后重新运行此脚本。"
    exit 1
fi

# 检测 LiteLoaderQQNT 本体关键文件
LL_ENTRY="$LLQQNT_DIR/src/main.js"
if [ ! -f "$LL_ENTRY" ]; then
    echo "错误: 检测到 LiteLoaderQQNT 目录，但缺少入口文件:"
    echo "  $LL_ENTRY"
    echo "请重新安装 LiteLoaderQQNT 本体后再运行此脚本。"
    exit 1
fi

echo "LiteLoaderQQNT: 已安装"

# 关键路径
LOADER_PATH="$QQ_APP/Contents/Resources/app/app_launcher/LiteLoader.js"
BACKUP_PATH="${LOADER_PATH}.bak"
PKG_BACKUP_PATH="${PKG_JSON}.bak"
EXPECTED_MAIN="./app_launcher/LiteLoader.js"

# 当前 package.json main
CURRENT_MAIN="$(node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(pkg.main||'')" "$PKG_JSON")"

if [ "$CURRENT_MAIN" = "$EXPECTED_MAIN" ]; then
    echo "LiteLoaderQQNT 注入状态: 已安装到 QQ.app"
else
    echo "LiteLoaderQQNT 注入状态: 未安装到 QQ.app"
    echo "  当前 main: ${CURRENT_MAIN:-<empty>}"
    echo "  目标 main: $EXPECTED_MAIN"
fi

# 备份原始 LiteLoader.js 和 package.json
sudo mkdir -p "$(dirname "$LOADER_PATH")"

if [ -f "$LOADER_PATH" ] && [ ! -f "$BACKUP_PATH" ]; then
    echo "备份原始 LiteLoader.js → LiteLoader.js.bak"
    sudo cp "$LOADER_PATH" "$BACKUP_PATH"
fi

if [ -f "$PKG_JSON" ] && [ ! -f "$PKG_BACKUP_PATH" ]; then
    echo "备份原始 package.json → package.json.bak"
    sudo cp "$PKG_JSON" "$PKG_BACKUP_PATH"
fi

# 部署 LiteLoader.js
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "部署 LiteLoader.js..."
sudo cp "$SCRIPT_DIR/LiteLoader.js" "$LOADER_PATH"

# 修改 QQ 启动入口到 LiteLoader.js
if [ "$CURRENT_MAIN" != "$EXPECTED_MAIN" ]; then
    echo "写入 LiteLoaderQQNT 启动入口到 package.json..."
    TMP_PKG="/tmp/qq-package.$$.json"
    node -e "
const fs = require('fs');
const pkgPath = process.argv[1];
const outPath = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.main = './app_launcher/LiteLoader.js';
fs.writeFileSync(outPath, JSON.stringify(pkg, null, 2) + '\n');
" "$PKG_JSON" "$TMP_PKG"
    sudo cp "$TMP_PKG" "$PKG_JSON"
    rm -f "$TMP_PKG"
fi

# 检查最终安装状态
FINAL_MAIN="$(node -e "const fs=require('fs');const pkg=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(pkg.main||'')" "$PKG_JSON")"
if [ "$FINAL_MAIN" != "$EXPECTED_MAIN" ]; then
    echo "错误: package.json main 修改失败，当前值为: ${FINAL_MAIN:-<empty>}"
    exit 1
fi

# 创建数据目录
DATA_DIR="$HOME/Library/Application Support/QQ/qq-export-data"
mkdir -p "$DATA_DIR"

echo ""
echo "安装后自检:"
echo "  - package.json main: $FINAL_MAIN"

if lsof -nP -iTCP:12333 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "  - 端口 12333: 已监听"
    SELF_CHECK_URL="http://127.0.0.1:12333/"
    if curl -fsS --max-time 2 "$SELF_CHECK_URL" >/dev/null 2>&1; then
        echo "  - HTTP 服务: 正常"
    else
        echo "  - HTTP 服务: 端口已监听，但首页请求失败"
    fi
else
    echo "  - 端口 12333: 未监听"
    echo "  - 说明: 这通常是因为 QQ 还未完全重启，或 LiteLoaderQQNT 尚未在本次启动中加载"
fi

echo ""
echo "===== 安装完成 ====="
echo ""
echo "使用方法:"
echo "  1. 重启 QQ（完全退出再打开）"
echo "  2. 打开浏览器访问 http://127.0.0.1:12333"
echo "  3. 输入QQ号 → 查询 → 导出"
echo ""
echo "导出文件保存在: $DATA_DIR"
echo "LiteLoaderQQNT 已接入 QQ.app: $FINAL_MAIN"
echo ""
