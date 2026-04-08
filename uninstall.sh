#!/bin/bash
set -e

echo "===== QQ聊天记录导出工具 - 卸载 ====="

QQ_APP="/Applications/QQ.app"
LOADER_PATH="$QQ_APP/Contents/Resources/app/app_launcher/LiteLoader.js"
BACKUP_PATH="${LOADER_PATH}.bak"
PKG_JSON="$QQ_APP/Contents/Resources/app/package.json"
PKG_BACKUP_PATH="${PKG_JSON}.bak"

if [ -f "$BACKUP_PATH" ]; then
    echo "恢复原始 LiteLoader.js..."
    sudo cp "$BACKUP_PATH" "$LOADER_PATH"
    sudo rm "$BACKUP_PATH"
fi

if [ -f "$PKG_BACKUP_PATH" ]; then
    echo "恢复原始 package.json..."
    sudo cp "$PKG_BACKUP_PATH" "$PKG_JSON"
    sudo rm "$PKG_BACKUP_PATH"
fi

echo "已恢复。重启 QQ 即可。"
