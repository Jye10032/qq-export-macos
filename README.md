# qq-export-macos

macOS 上导出 QQ 聊天记录，支持 TXT / HTML / JSON 格式，可选下载图片和视频。

## 原理

通过 LiteLoaderQQNT 注入 QQ 进程，使用 `queryMsgsWithFilterEx` 直接查询本地消息数据库，一次性导出全部聊天记录。

## 前置条件

- macOS
- **官网版 QQ**（从 [im.qq.com](https://im.qq.com) 下载，不支持 App Store 版）
- [LiteLoaderQQNT](https://liteloaderqqnt.github.io/guide/install.html) 已安装

## 当前兼容性

重装 QQ 后，即使 `~/Library/Application Support/LiteLoaderQQNT` 目录仍然存在，也不代表 LiteLoaderQQNT 已经真正接入新的 `QQ.app`。

当前脚本会主动检测 `QQ.app/Contents/Resources/app/package.json` 的 `main` 是否已经指向 `./app_launcher/LiteLoader.js`。如果没有，它会按 LiteLoaderQQNT 的接入方式把 QQ 的启动入口改到外层 `LiteLoader.js`，避免出现“脚本提示已安装，但 QQ 里看不到 LiteLoaderQQNT，访问 127.0.0.1 仍然拒绝连接”的假安装状态。

## 安装

```bash
git clone https://github.com/Jye10032/qq-export-macos.git
cd qq-export-macos
./install.sh
```

安装脚本会做两件事：

1. 检测 `~/Library/Application Support/LiteLoaderQQNT` 是否存在，并确认入口文件 `src/main.js` 可用
2. 按 LiteLoaderQQNT 官方手动安装方式修改 `QQ.app/Contents/Resources/app/package.json`，把 `main` 指向 `./app_launcher/LiteLoader.js`

安装结束后，脚本还会做一次自检：

1. 确认 `package.json main` 是否已经改为 `./app_launcher/LiteLoader.js`
2. 检查 `127.0.0.1:12333` 是否已经在监听
3. 如果端口已监听，再请求一次首页确认 HTTP 服务是否正常

安装脚本只会替换 `LiteLoader.js`，不会重签 `QQ.app`。这样可以避免 macOS 因应用签名变化而让 QQ 丢失原有的录屏、截图、辅助功能等系统权限。

如果你此前使用过旧版脚本，且 QQ 已经出现权限失效，通常需要卸载并重新安装官网版 QQ 后，再重新执行安装。

## 使用

1. 重启 QQ（完全退出再打开）
2. 浏览器打开 `http://127.0.0.1:12333`
3. 输入对方 QQ 号 → 点击「查询」
4. 选择导出格式 → 点击「导出」

### 导出格式

| 格式 | 说明 |
|------|------|
| TXT | 纯文本，体积小，方便搜索 |
| HTML | 网页格式，聊天气泡样式，支持内联图片/视频/音频 |
| JSON | 结构化数据，包含完整消息元素，适合程序处理 |

勾选「下载媒体文件」可将图片、视频、语音下载到本地。

导出文件保存在 `~/Library/Application Support/QQ/qq-export-data/{QQ号}/`

## 卸载

```bash
./uninstall.sh
```

卸载脚本会同时恢复 `LiteLoader.js` 和 `package.json` 备份。

## 限制

- 仅支持私聊导出（好友关系）
- 只能导出本地数据库中已有的消息（QQ 已同步到本地的）
- 媒体下载依赖 QQ 本地缓存和 QQ 服务器，部分历史媒体可能无法下载

## 致谢

- [qq-chat-exporter](https://github.com/shuakami/qq-chat-exporter) — 原始项目
- [LiteLoaderQQNT](https://github.com/LiteLoaderQQNT/LiteLoaderQQNT) — QQ 插件加载框架
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) — wrapper.node hook 思路
