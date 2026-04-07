# qq-export-macos

macOS 上导出 QQ 聊天记录，支持 TXT / HTML / JSON 格式，可选下载图片和视频。

## 原理

通过 LiteLoaderQQNT 注入 QQ 进程，使用 `queryMsgsWithFilterEx` 直接查询本地消息数据库，一次性导出全部聊天记录。

## 前置条件

- macOS
- **官网版 QQ**（从 [im.qq.com](https://im.qq.com) 下载，不支持 App Store 版）
- [LiteLoaderQQNT](https://liteloaderqqnt.github.io/guide/install.html) 已安装

## 安装

```bash
git clone https://github.com/Jye10032/qq-export-macos.git
cd qq-export-macos
./install.sh
```

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

## 限制

- 仅支持私聊导出（好友关系）
- 只能导出本地数据库中已有的消息（QQ 已同步到本地的）
- 媒体下载依赖 QQ 本地缓存和 QQ 服务器，部分历史媒体可能无法下载

## 致谢

- [qq-chat-exporter](https://github.com/shuakami/qq-chat-exporter) — 原始项目
- [LiteLoaderQQNT](https://github.com/LiteLoaderQQNT/LiteLoaderQQNT) — QQ 插件加载框架
- [NapCatQQ](https://github.com/NapNeko/NapCatQQ) — wrapper.node hook 思路
