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

echo "LiteLoaderQQNT: 已安装"

# 备份原始 LiteLoader.js
LOADER_PATH="$QQ_APP/Contents/Resources/app/app_launcher/LiteLoader.js"
BACKUP_PATH="${LOADER_PATH}.bak"

if [ -f "$LOADER_PATH" ] && [ ! -f "$BACKUP_PATH" ]; then
    echo "备份原始 LiteLoader.js → LiteLoader.js.bak"
    sudo cp "$LOADER_PATH" "$BACKUP_PATH"
fi

# 部署 LiteLoader.js
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "部署 LiteLoader.js..."
sudo cp "$SCRIPT_DIR/LiteLoader.js" "$LOADER_PATH"

# 去掉 QQ 签名（解除沙盒限制）
echo "重签 QQ.app（去除沙盒限制）..."
cat > /tmp/qq-nosandbox.plist << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
</dict>
</plist>
PLIST
sudo codesign --force --deep --sign - --entitlements /tmp/qq-nosandbox.plist "$QQ_APP" 2>/dev/null || true
rm -f /tmp/qq-nosandbox.plist

# 创建数据目录
DATA_DIR="$HOME/Library/Application Support/QQ/qq-export-data"
mkdir -p "$DATA_DIR"

echo ""
echo "===== 安装完成 ====="
echo ""
echo "使用方法:"
echo "  1. 重启 QQ（完全退出再打开）"
echo "  2. 打开浏览器访问 http://127.0.0.1:12333"
echo "  3. 输入QQ号 → 查询 → 导出"
echo ""
echo "导出文件保存在: $DATA_DIR"
echo ""
