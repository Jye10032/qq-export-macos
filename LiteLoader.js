const path = require("path");
const os = require("os");
const fs = require("fs");
const http = require("http");

// ===== 环境修复 =====
const realHome = '/Users/' + (process.env.USER || require('child_process').execSync('whoami').toString().trim());
process.env.HOME = realHome;
process.env.USERPROFILE = realHome;
os.homedir = () => realHome;

const homedir = realHome;
const profilePath = path.join(homedir, "Library", "Application Support", "LiteLoaderQQNT");
const logFile = path.join(homedir, "Library", "Application Support", "QQ", "qq-export-debug.log");
const dataDir = path.join(path.dirname(profilePath), "QQ", "qq-export-data");

function log(msg) {
    try { fs.appendFileSync(logFile, new Date().toISOString() + " " + msg + "\n"); } catch(e) {}
}

process.env.LITELOADERQQNT_PROFILE = profilePath;
process.on('uncaughtException', (err) => { log("UNCAUGHT: " + err.message); });
process.on('unhandledRejection', (reason) => { log("REJECTION: " + (reason && reason.message || reason)); });

try { fs.mkdirSync(dataDir, { recursive: true }); } catch(e) {}

let wrapperSession = null;
let origExports = null;

// ===== wrapper.node hook =====
const origDlopen = process.dlopen;
process.dlopen = function(module, filename, flags) {
    const ret = origDlopen.call(process, module, filename, flags);
    if (!filename || !filename.includes('wrapper.node')) return ret;
    process.dlopen = origDlopen;

    origExports = module.exports;
    const origGetSession = origExports.NodeIQQNTWrapperSession.getNTWrapperSession;

    const newExports = {};
    for (const key of Object.getOwnPropertyNames(origExports)) newExports[key] = origExports[key];

    function PS() {}
    for (const key of Object.getOwnPropertyNames(origExports.NodeIQQNTWrapperSession)) {
        if (key !== 'getNTWrapperSession') try { PS[key] = origExports.NodeIQQNTWrapperSession[key]; } catch(e) {}
    }
    PS.prototype = origExports.NodeIQQNTWrapperSession.prototype;
    PS.getNTWrapperSession = function() {
        const session = origGetSession.apply(origExports.NodeIQQNTWrapperSession, arguments);
        if (!wrapperSession) {
            wrapperSession = session;
            log("Session captured");
            startExportServer(session);
        }
        return session;
    };
    newExports.NodeIQQNTWrapperSession = PS;
    module.exports = newExports;
    log("patched");
    return ret;
};
// ===== 导出服务 =====
async function startExportServer(session) {
    await new Promise(resolve => {
        const check = () => {
            try { if (session.getMsgService()) { resolve(); return; } } catch(e) {}
            setTimeout(check, 1000);
        };
        setTimeout(check, 3000);
    });
    log("Session ready");

    // ===== 公共函数 =====

    async function getBuddyList() {
        const svc = session.getBuddyService();
        return new Promise((resolve) => {
            const listener = {
                onBuddyListChange: (data) => {
                    try { svc.removeKernelBuddyListener(lid); } catch(e) {}
                    const all = Array.isArray(data) ? data.flatMap(cat => cat.buddyList || []) : [];
                    resolve(all);
                }
            };
            const proxied = new Proxy(listener, { get: (t, p) => t[p] || (() => {}) });
            const lid = svc.addKernelBuddyListener(proxied);
            svc.getBuddyList(true);
            setTimeout(() => resolve([]), 8000);
        });
    }

    async function findPeerByUin(uin) {
        const buddies = await getBuddyList();
        const buddy = buddies.find(b => (b.uin === uin) || (b.coreInfo?.uin === uin));
        if (!buddy) return null;
        return {
            nick: buddy.coreInfo?.nick || buddy.nick || uin,
            uid: buddy.uid || buddy.coreInfo?.uid,
            uin: uin
        };
    }

    async function fetchAllMessages(peer) {
        const result = await session.getMsgService().queryMsgsWithFilterEx("0", "0", "0", {
            chatInfo: peer, filterMsgType: [], filterSendersUid: [],
            filterMsgToTime: "0", filterMsgFromTime: "0",
            isReverseOrder: false, isIncludeCurrent: true, pageLimit: 200000
        });
        const msgs = result?.msgList || [];
        msgs.sort((a, b) => (parseInt(a.msgTime) || 0) - (parseInt(b.msgTime) || 0));
        return msgs;
    }

    function fmtTime(ts) {
        const t = parseInt(ts);
        const d = new Date(t > 1e10 ? t : t * 1000);
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    }

    function getFileExt(fileName, fallback) {
        if (fileName) {
            const ext = path.extname(fileName).toLowerCase();
            if (ext) return ext;
        }
        return fallback || '.dat';
    }
    // ===== 媒体下载 =====

    async function downloadMediaFile(msg, element) {
        // 优先使用本地缓存
        const cachePath = element.picElement?.sourcePath
            || element.videoElement?.filePath
            || element.pttElement?.filePath
            || element.fileElement?.filePath;
        if (cachePath && fs.existsSync(cachePath)) return cachePath;

        // 通过 session API 下载
        const msgService = session.getMsgService();
        return new Promise((resolve) => {
            let resolved = false;
            const listener = {
                onRichMediaDownloadComplete: (data) => {
                    if (resolved) return;
                    if (data.msgId === msg.msgId && data.msgElementId === element.elementId) {
                        resolved = true;
                        try { msgService.removeKernelMsgListener(lid); } catch(e) {}
                        resolve(data.filePath || null);
                    }
                }
            };
            const proxied = new Proxy(listener, { get: (t, p) => t[p] || (() => {}) });
            const lid = msgService.addKernelMsgListener(proxied);

            msgService.downloadRichMedia({
                fileModelId: "0", downSourceType: 0, downloadSourceType: 0,
                triggerType: 1, msgId: msg.msgId, chatType: msg.chatType,
                peerUid: msg.peerUid, elementId: element.elementId,
                thumbSize: 0, downloadType: 1, filePath: ""
            });

            setTimeout(() => {
                if (!resolved) { resolved = true; try { msgService.removeKernelMsgListener(lid); } catch(e) {} resolve(null); }
            }, 30000);
        });
    }

    async function saveMediaToExportDir(msg, element, mediaDir) {
        try {
            const srcPath = await downloadMediaFile(msg, element);
            if (!srcPath || !fs.existsSync(srcPath)) return null;

            let ext = '.dat';
            if (element.picElement) ext = getFileExt(element.picElement.fileName, '.jpg');
            else if (element.videoElement) ext = getFileExt(element.videoElement.fileName, '.mp4');
            else if (element.pttElement) ext = getFileExt(element.pttElement.fileName, '.amr');
            else if (element.fileElement) ext = getFileExt(element.fileElement.fileName, '.dat');

            const destName = `${msg.msgId}_${element.elementId}${ext}`;
            const destPath = path.join(mediaDir, destName);
            fs.copyFileSync(srcPath, destPath);
            return destName;
        } catch(e) {
            log(`[MEDIA] Download failed: ${e.message}`);
            return null;
        }
    }
    // ===== 结构化消息解析 =====

    function parseElementsRich(elements) {
        if (!elements || !Array.isArray(elements)) return [{ type: 'text', content: '[未知消息]' }];
        const parts = [];
        for (const el of elements) {
            if (el.textElement?.content) {
                parts.push({ type: 'text', content: el.textElement.content });
            } else if (el.picElement) {
                parts.push({
                    type: 'image', fileName: el.picElement.fileName,
                    fileSize: el.picElement.fileSize, width: el.picElement.picWidth,
                    height: el.picElement.picHeight, sourcePath: el.picElement.sourcePath,
                    originUrl: el.picElement.originImageUrl, localFile: null
                });
            } else if (el.videoElement) {
                parts.push({
                    type: 'video', fileName: el.videoElement.fileName,
                    fileSize: el.videoElement.fileSize, duration: el.videoElement.duration,
                    sourcePath: el.videoElement.filePath, localFile: null
                });
            } else if (el.pttElement) {
                parts.push({
                    type: 'audio', fileName: el.pttElement.fileName,
                    fileSize: el.pttElement.fileSize, duration: el.pttElement.duration,
                    sourcePath: el.pttElement.filePath, localFile: null
                });
            } else if (el.faceElement) {
                const faceId = el.faceElement.faceIndex ?? el.faceElement.faceType ?? 0;
                const faceText = el.faceElement.faceText || '';
                parts.push({ type: 'emoji', faceId, faceText });
            } else if (el.replyElement) {
                parts.push({ type: 'reply', replyMsgSeq: el.replyElement.replayMsgSeq || el.replyElement.replyMsgSeq });
            } else if (el.arkElement) {
                let raw = el.arkElement.bytesData || '';
                let parsed = null;
                try { parsed = JSON.parse(raw); } catch(e) {}
                // 提取卡片信息
                let title = '', desc = '', url = '', preview = '';
                if (parsed) {
                    const meta = parsed.meta || {};
                    const d1 = meta.detail_1 || meta.news || meta.detail || {};
                    title = parsed.prompt || d1.title || '';
                    desc = d1.desc || '';
                    url = d1.qqdocurl || d1.url || d1.jumpUrl || '';
                    preview = d1.preview || '';
                }
                parts.push({ type: 'card', title, desc, url, preview, raw: parsed || raw });
            } else if (el.marketFaceElement) {
                const emojiId = el.marketFaceElement.emojiId || '';
                const name = el.marketFaceElement.faceName || '';
                // 构造 GIF URL
                let imgUrl = '';
                if (emojiId) {
                    const dir = emojiId.substring(0, 2);
                    imgUrl = `https://gxh.vip.qq.com/club/item/parcel/item/${dir}/${emojiId}/raw300.gif`;
                }
                parts.push({ type: 'sticker', name, emojiId, imgUrl });
            } else if (el.fileElement) {
                parts.push({
                    type: 'file', fileName: el.fileElement.fileName,
                    fileSize: el.fileElement.fileSize, sourcePath: el.fileElement.filePath, localFile: null
                });
            } else if (el.grayTipElement) {
                parts.push({ type: 'system', content: el.grayTipElement.xmlElement?.content || el.grayTipElement.jsonGrayTipElement?.jsonStr || '[系统提示]' });
            }
        }
        return parts.length > 0 ? parts : [{ type: 'text', content: '[空消息]' }];
    }

    function richToText(parts) {
        return parts.map(p => {
            switch(p.type) {
                case 'text': return p.content;
                case 'image': return p.localFile ? `[图片: ${p.localFile}]` : '[图片]';
                case 'video': return p.localFile ? `[视频: ${p.localFile}]` : '[视频]';
                case 'audio': return p.localFile ? `[语音: ${p.localFile}]` : `[语音 ${p.duration || '?'}s]`;
                case 'emoji': return p.faceText || `[表情${p.faceId}]`;
                case 'reply': return '';
                case 'card': return p.title ? `[卡片: ${p.title}]` : '[卡片消息]';
                case 'sticker': return `[${p.name || '表情'}]`;
                case 'file': return `[文件: ${p.fileName || ''}]`;
                case 'system': return '[系统提示]';
                default: return '';
            }
        }).join('') || '[空消息]';
    }
    // ===== 媒体下载辅助 =====

    async function downloadAllMedia(msgs, mediaDir, progressCb) {
        fs.mkdirSync(mediaDir, { recursive: true });
        let done = 0;
        for (const msg of msgs) {
            if (!msg.elements) continue;
            for (const el of msg.elements) {
                if (el.picElement || el.videoElement || el.pttElement || el.fileElement) {
                    const localName = await saveMediaToExportDir(msg, el, mediaDir);
                    if (localName) {
                        // 标记到 element 上供后续使用
                        if (el.picElement) el.picElement._localFile = localName;
                        else if (el.videoElement) el.videoElement._localFile = localName;
                        else if (el.pttElement) el.pttElement._localFile = localName;
                        else if (el.fileElement) el.fileElement._localFile = localName;
                    }
                }
            }
            done++;
            if (progressCb && done % 100 === 0) progressCb(done, msgs.length);
        }
    }

    function enrichParts(elements) {
        const parts = parseElementsRich(elements);
        for (const el of (elements || [])) {
            if (el.picElement?._localFile) {
                const p = parts.find(x => x.type === 'image' && x.fileName === el.picElement.fileName);
                if (p) p.localFile = el.picElement._localFile;
            }
            if (el.videoElement?._localFile) {
                const p = parts.find(x => x.type === 'video' && x.fileName === el.videoElement.fileName);
                if (p) p.localFile = el.videoElement._localFile;
            }
            if (el.pttElement?._localFile) {
                const p = parts.find(x => x.type === 'audio' && x.fileName === el.pttElement.fileName);
                if (p) p.localFile = el.pttElement._localFile;
            }
            if (el.fileElement?._localFile) {
                const p = parts.find(x => x.type === 'file' && x.fileName === el.fileElement.fileName);
                if (p) p.localFile = el.fileElement._localFile;
            }
        }
        return parts;
    }

    // ===== TXT 导出 =====

    async function exportToTxt(peerInfo, peer, withMedia) {
        const msgs = await fetchAllMessages(peer);
        const exportDir = path.join(dataDir, peerInfo.uin);
        fs.mkdirSync(exportDir, { recursive: true });

        if (withMedia) {
            const mediaDir = path.join(exportDir, 'media');
            await downloadAllMedia(msgs, mediaDir, (d, t) => log(`[TXT] Media ${d}/${t}`));
        }

        const outFile = path.join(exportDir, `${peerInfo.uin}.txt`);
        const now = new Date();
        const p = n => String(n).padStart(2, '0');
        const header = `QQ聊天记录导出 - ${peerInfo.nick}(${peerInfo.uin})\n导出时间: ${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}\n消息总数: ${msgs.length}\n==================================================\n\n`;

        fs.writeFileSync(outFile, header, 'utf-8');
        for (let i = 0; i < msgs.length; i += 1000) {
            const chunk = msgs.slice(i, i + 1000);
            let text = '';
            for (const msg of chunk) {
                const sender = msg.sendNickName || msg.sendMemberName || msg.senderUin || '未知';
                const parts = withMedia ? enrichParts(msg.elements) : parseElementsRich(msg.elements);
                text += `${fmtTime(msg.msgTime)} ${sender}:\n${richToText(parts)}\n\n`;
            }
            fs.appendFileSync(outFile, text, 'utf-8');
        }
        log(`[TXT] Done: ${msgs.length} msgs → ${outFile}`);
        return { count: msgs.length, file: outFile };
    }
    // ===== JSON 导出 =====

    async function exportToJson(peerInfo, peer, withMedia) {
        const msgs = await fetchAllMessages(peer);
        const exportDir = path.join(dataDir, peerInfo.uin);
        fs.mkdirSync(exportDir, { recursive: true });

        if (withMedia) {
            const mediaDir = path.join(exportDir, 'media');
            await downloadAllMedia(msgs, mediaDir, (d, t) => log(`[JSON] Media ${d}/${t}`));
        }

        const result = {
            exportTime: new Date().toISOString(),
            peer: { nick: peerInfo.nick, uin: peerInfo.uin },
            totalCount: msgs.length,
            messages: msgs.map(msg => ({
                msgId: msg.msgId, msgSeq: msg.msgSeq,
                time: parseInt(msg.msgTime),
                timeStr: fmtTime(msg.msgTime),
                sender: { nick: msg.sendNickName || msg.sendMemberName || '未知', uin: msg.senderUin || '', uid: msg.senderUid || '' },
                elements: withMedia ? enrichParts(msg.elements) : parseElementsRich(msg.elements)
            }))
        };

        const outFile = path.join(exportDir, `${peerInfo.uin}.json`);
        fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf-8');
        log(`[JSON] Done: ${msgs.length} msgs → ${outFile}`);
        return { count: msgs.length, file: outFile };
    }
    // ===== HTML 导出 =====

    function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function partsToHtml(parts, mediaPrefix) {
        return parts.map(p => {
            switch(p.type) {
                case 'text': return escHtml(p.content).replace(/\n/g, '<br>');
                case 'image':
                    if (p.localFile) return `<img src="${mediaPrefix}${escHtml(p.localFile)}" style="max-width:300px;max-height:300px;border-radius:4px;cursor:pointer" onclick="window.open(this.src)" loading="lazy">`;
                    return '<span class="tag">[图片]</span>';
                case 'video':
                    if (p.localFile) return `<video src="${mediaPrefix}${escHtml(p.localFile)}" controls style="max-width:300px;border-radius:4px"></video>`;
                    return `<span class="tag">[视频${p.duration ? ' ' + p.duration + 's' : ''}]</span>`;
                case 'audio':
                    if (p.localFile) return `<audio src="${mediaPrefix}${escHtml(p.localFile)}" controls></audio>`;
                    return `<span class="tag voice">&#9835; 语音 ${p.duration || '?'}s</span>`;
                case 'emoji':
                    return `<img src="https://qq-face.vercel.app/gif/s${p.faceId}.gif" alt="${escHtml(p.faceText || '表情')}" title="${escHtml(p.faceText || '表情' + p.faceId)}" class="face" onerror="this.outerHTML='<span class=\\'tag\\'>${escHtml(p.faceText || '[表情]')}</span>'">`;
                case 'reply': return '';
                case 'card': {
                    let html = '<div class="card">';
                    if (p.preview) html += `<img src="${escHtml(p.preview)}" class="card-img" loading="lazy" onerror="this.style.display='none'">`;
                    html += `<div class="card-body">`;
                    if (p.url) html += `<a href="${escHtml(p.url)}" target="_blank" class="card-title">${escHtml(p.title || '卡片消息')}</a>`;
                    else html += `<div class="card-title">${escHtml(p.title || '卡片消息')}</div>`;
                    if (p.desc) html += `<div class="card-desc">${escHtml(p.desc)}</div>`;
                    html += '</div></div>';
                    return html;
                }
                case 'sticker':
                    if (p.imgUrl) return `<img src="${escHtml(p.imgUrl)}" alt="${escHtml(p.name || '表情')}" title="${escHtml(p.name || '表情')}" class="sticker" loading="lazy" onerror="this.outerHTML='<span class=\\'tag\\'>[${escHtml(p.name || '表情')}]</span>'">`;
                    return `<span class="tag">[${escHtml(p.name || '表情')}]</span>`;
                case 'file':
                    if (p.localFile) return `<a href="${mediaPrefix}${escHtml(p.localFile)}" class="file-link">&#128196; ${escHtml(p.fileName || '文件')}</a>`;
                    return `<span class="tag">&#128196; ${escHtml(p.fileName || '文件')}</span>`;
                case 'system': return `<div class="sys">${escHtml(typeof p.content === 'string' ? p.content : '[系统提示]')}</div>`;
                default: return '';
            }
        }).join('');
    }

    async function exportToHtml(peerInfo, peer, selfUin, withMedia) {
        const msgs = await fetchAllMessages(peer);
        const exportDir = path.join(dataDir, peerInfo.uin);
        fs.mkdirSync(exportDir, { recursive: true });

        if (withMedia) {
            const mediaDir = path.join(exportDir, 'media');
            await downloadAllMedia(msgs, mediaDir, (d, t) => log(`[HTML] Media ${d}/${t}`));
        }

        const mediaPrefix = 'media/';
        const outFile = path.join(exportDir, `${peerInfo.uin}.html`);
        const now = new Date();
        const p = n => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;
        const htmlHead = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>聊天记录 - ${escHtml(peerInfo.nick)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f0f0;padding:20px}
.header{text-align:center;padding:20px;background:#fff;border-radius:12px;margin-bottom:20px;box-shadow:0 1px 4px rgba(0,0,0,.06);max-width:800px;margin-left:auto;margin-right:auto}
.header h1{font-size:18px;color:#333;margin-bottom:8px}
.header .meta{font-size:13px;color:#999}
.chat{max-width:800px;margin:0 auto}
.date-sep{text-align:center;margin:16px 0;font-size:12px;color:#999}
.date-sep span{background:#e8e8e8;padding:2px 12px;border-radius:10px}
.msg{display:flex;margin:8px 0;gap:8px}
.msg.self{flex-direction:row-reverse}
.msg-inner{max-width:65%;display:flex;flex-direction:column}
.msg.self .msg-inner{align-items:flex-end}
.nick{font-size:11px;color:#999;margin-bottom:3px;padding:0 6px}
.bubble{padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.6;word-break:break-word}
.msg:not(.self) .bubble{background:#fff;border-top-left-radius:4px}
.msg.self .bubble{background:#95ec69;border-top-right-radius:4px}
.time{font-size:10px;color:#bbb;margin-top:3px;padding:0 6px}
.msg.self .time{text-align:right}
.tag{background:rgba(0,0,0,.06);color:#888;padding:2px 8px;border-radius:4px;font-size:12px;display:inline-block}
.voice{background:#e8f5e9;color:#4caf50}
.sys{text-align:center;font-size:12px;color:#999;margin:10px 0;padding:4px 0}
.face{width:24px;height:24px;vertical-align:middle;display:inline}
.sticker{max-width:120px;max-height:120px;display:block;margin:4px 0}
img:not(.face):not(.sticker):not(.card-img){display:block;margin:4px 0;max-width:300px;max-height:300px;border-radius:4px;cursor:pointer}
video,audio{display:block;margin:4px 0}
video{max-width:300px;border-radius:4px}
.card{border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;margin:4px 0;max-width:280px;background:#fafafa}
.card-img{width:100%;max-height:150px;object-fit:cover;display:block}
.card-body{padding:8px 10px}
.card-title{font-size:13px;color:#333;font-weight:500;text-decoration:none;display:block;margin-bottom:2px}
a.card-title{color:#4a90d9}
a.card-title:hover{text-decoration:underline}
.card-desc{font-size:11px;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.file-link{display:inline-block;padding:6px 10px;background:#f5f5f5;border-radius:6px;color:#333;text-decoration:none;font-size:13px}
.file-link:hover{background:#e8e8e8}
</style></head><body>
<div class="header"><h1>${escHtml(peerInfo.nick)} (${escHtml(peerInfo.uin)})</h1>
<div class="meta">消息总数: ${msgs.length} | 导出时间: ${dateStr}</div></div>
<div class="chat">
`;
        fs.writeFileSync(outFile, htmlHead, 'utf-8');

        let lastDate = '';
        for (let i = 0; i < msgs.length; i += 500) {
            const chunk = msgs.slice(i, i + 500);
            let html = '';
            for (const msg of chunk) {
                const timeStr = fmtTime(msg.msgTime);
                const dateOnly = timeStr.slice(0, 10);
                if (dateOnly !== lastDate) {
                    html += `<div class="date-sep"><span>${escHtml(dateOnly)}</span></div>\n`;
                    lastDate = dateOnly;
                }
                const sender = msg.sendNickName || msg.sendMemberName || msg.senderUin || '未知';
                const isSelf = msg.senderUin === selfUin;
                const parts = withMedia ? enrichParts(msg.elements) : parseElementsRich(msg.elements);
                const content = partsToHtml(parts, mediaPrefix);
                if (!content) continue;

                html += `<div class="msg${isSelf ? ' self' : ''}">`;
                html += `<div class="msg-inner"><div class="nick">${escHtml(sender)}</div>`;
                html += `<div class="bubble">${content}</div>`;
                html += `<div class="time">${escHtml(timeStr.slice(11))}</div></div></div>\n`;
            }
            fs.appendFileSync(outFile, html, 'utf-8');
        }

        fs.appendFileSync(outFile, '</div></body></html>', 'utf-8');
        log(`[HTML] Done: ${msgs.length} msgs → ${outFile}`);
        return { count: msgs.length, file: outFile };
    }
    // ===== HTTP 服务 =====
    const PORT = 12333;
    // 获取自己的 QQ 号（用于 HTML 中区分左右气泡）
    let selfUin = '';
    try {
        const loginSvc = session.getLoginService?.() || session.getLoginService?.call(session);
        if (loginSvc?.getLoginInfo) { selfUin = loginSvc.getLoginInfo()?.uin || ''; }
    } catch(e) {}

    const HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>QQ聊天记录导出</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#f5f5f5;display:flex;justify-content:center;padding-top:60px}
.box{background:#fff;border-radius:12px;padding:32px;width:460px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h2{font-size:18px;margin-bottom:20px;color:#333}
input{width:100%;padding:10px 14px;border:1px solid #ddd;border-radius:8px;font-size:15px;outline:none;margin-bottom:12px}
input:focus{border-color:#4a90d9}
.row{display:flex;gap:8px;align-items:center;margin-bottom:12px}
select{padding:8px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px;outline:none;background:#fff}
label{font-size:13px;color:#555;display:flex;align-items:center;gap:4px;cursor:pointer}
button{padding:10px 20px;border:none;border-radius:8px;font-size:14px;cursor:pointer;margin-right:8px}
.btn-query{background:#4a90d9;color:#fff}
.btn-export{background:#52c41a;color:#fff}
button:disabled{opacity:.5;cursor:not-allowed}
.info{margin:16px 0;padding:12px;background:#f0f7ff;border-radius:8px;font-size:14px;color:#333;display:none}
.status{margin-top:12px;font-size:13px;color:#888}
.tip{font-size:12px;color:#aaa;margin-top:16px;line-height:1.6}
</style></head><body>
<div class="box">
<h2>QQ聊天记录导出 (macOS)</h2>
<input id="uin" placeholder="输入QQ号" autofocus>
<div><button class="btn-query" onclick="query()">查询</button></div>
<div class="info" id="info"></div>
<div class="row">
<select id="fmt"><option value="txt">TXT 纯文本</option><option value="html" selected>HTML 网页</option><option value="json">JSON 数据</option></select>
<label><input type="checkbox" id="media"> 下载媒体文件</label>
<button class="btn-export" id="btnExport" disabled onclick="doExport()">导出</button>
</div>
<div class="status" id="status"></div>
<div class="tip">导出文件保存在: ~/Library/Application Support/QQ/qq-export-data/<br>HTML 格式支持图片内联显示，JSON 格式包含完整结构化数据</div>
</div>
<script>
let currentUin='';
async function query(){
  const uin=document.getElementById('uin').value.trim();
  if(!uin){alert('请输入QQ号');return}
  const info=document.getElementById('info');
  const st=document.getElementById('status');
  info.style.display='none';st.textContent='查询中...';
  document.getElementById('btnExport').disabled=true;
  try{
    const r=await fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uin})});
    const d=await r.json();
    if(d.error){st.textContent=d.error;return}
    currentUin=uin;
    info.style.display='block';
    info.innerHTML='<b>'+d.nick+'</b> ('+uin+')<br>消息总数: <b>'+d.count+'</b> 条';
    st.textContent='';
    document.getElementById('btnExport').disabled=false;
  }catch(e){st.textContent='查询失败: '+e.message}
}
async function doExport(){
  if(!currentUin)return;
  const st=document.getElementById('status');
  const fmt=document.getElementById('fmt').value;
  const media=document.getElementById('media').checked;
  st.textContent='导出中'+(media?' (含媒体下载，可能较慢)':'')+' ...';
  document.getElementById('btnExport').disabled=true;
  try{
    const r=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({uin:currentUin,format:fmt,downloadMedia:media})});
    const d=await r.json();
    if(d.error){st.textContent=d.error;return}
    st.textContent='导出完成! '+d.count+' 条消息 → '+d.file;
    document.getElementById('btnExport').disabled=false;
  }catch(e){st.textContent='导出失败: '+e.message}
}
document.getElementById('uin').addEventListener('keydown',e=>{if(e.key==='Enter')query()});
</script></body></html>`;
    const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
        '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.amr': 'audio/amr', '.silk': 'audio/silk', '.wav': 'audio/wav' };

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://localhost:${PORT}`);

        if (req.method === 'GET' && url.pathname === '/') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(HTML);
            return;
        }

        // 静态媒体文件服务: /media/{uin}/{filename}
        if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
            const parts = url.pathname.slice(7).split('/');
            if (parts.length === 2) {
                const filePath = path.join(dataDir, parts[0], 'media', parts[1]);
                if (fs.existsSync(filePath)) {
                    const ext = path.extname(filePath).toLowerCase();
                    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'max-age=86400' });
                    fs.createReadStream(filePath).pipe(res);
                    return;
                }
            }
            res.writeHead(404); res.end('Not found'); return;
        }

        if (req.method === 'POST') {
            let body = '';
            req.on('data', c => body += c);
            req.on('end', async () => {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
                try {
                    const data = JSON.parse(body);
                    const uin = String(data.uin).trim();

                    if (url.pathname === '/api/query') {
                        const info = await findPeerByUin(uin);
                        if (!info) { res.end(JSON.stringify({ error: `未找到QQ号 ${uin}，请确认是好友关系` })); return; }
                        const peer = { chatType: 1, peerUid: info.uid, guildId: "" };
                        const msgs = await fetchAllMessages(peer);
                        res.end(JSON.stringify({ nick: info.nick, uin, count: msgs.length }));
                    }
                    else if (url.pathname === '/api/export') {
                        const info = await findPeerByUin(uin);
                        if (!info) { res.end(JSON.stringify({ error: `未找到QQ号 ${uin}` })); return; }
                        const peer = { chatType: 1, peerUid: info.uid, guildId: "" };
                        const fmt = data.format || 'txt';
                        const withMedia = !!data.downloadMedia;

                        let result;
                        if (fmt === 'json') result = await exportToJson(info, peer, withMedia);
                        else if (fmt === 'html') result = await exportToHtml(info, peer, selfUin, withMedia);
                        else result = await exportToTxt(info, peer, withMedia);

                        res.end(JSON.stringify(result));
                    }
                    else { res.end(JSON.stringify({ error: 'Not found' })); }
                } catch(e) {
                    log(`[SERVER] Error: ${e.message}\n${e.stack}`);
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
            return;
        }

        res.writeHead(404); res.end('Not found');
    });

    server.listen(PORT, '127.0.0.1', () => {
        log(`Export server running at http://127.0.0.1:${PORT}`);
    });
}

log("Hook installed");
require(path.join(profilePath, "src", "main.js"));
log("LiteLoader loaded");
