#!/bin/bash
set -e

echo "===== QQ聊天记录导出工具 - 卸载 ====="

QQ_APP="/Applications/QQ.app"
LOADER_PATH="$QQ_APP/Contents/Resources/app/app_launcher/LiteLoader.js"
BACKUP_PATH="${LOADER_PATH}.bak"

if [ -f "$BACKUP_PATH" ]; then
    echo "恢复原始 LiteLoader.js..."
    sudo cp "$BACKUP_PATH" "$LOADER_PATH"
    sudo rm "$BACKUP_PATH"
    echo "已恢复。重启 QQ 即可。"
else
    echo "未找到备份文件，无需恢复。"
fi
