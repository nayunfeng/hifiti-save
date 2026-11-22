// ==UserScript==
// @name         HiFiTi 一键存网盘
// @name:zh-CN   HiFiTi 一键存网盘
// @namespace    local.hifiti.save
// @version      1.0.0
// @description  每日访问自动签到；一键回帖解锁、提取码和夸克转存，百度提供带码入口。
// @description:zh-CN 每日访问自动签到；一键回帖解锁、提取码和夸克转存，百度提供带码入口。
// @license      MIT
// @match        https://hifiti.com/*
// @match        https://www.hifiti.com/*
// @match        https://pan.quark.cn/s/*
// @run-at       document-idle
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @connect      drive-pc.quark.cn
// ==/UserScript==

(() => {
"use strict";
/* Original implementation. No external scripts or server. */
const HSave = (() => {
    const SHARE_HOSTS = {'pan.quark.cn': 'quark', 'pan.baidu.com': 'baidu'};

    function shareURL(raw) {
        try {
            const u = new URL(raw);
            if (u.protocol !== 'https:' || u.username || u.password || !SHARE_HOSTS[u.hostname]) return null;
            if (!/^\/s\/[\w-]+\/?$/.test(u.pathname)) return null;
            return {
                provider: SHARE_HOSTS[u.hostname],
                url: u.href,
                id: u.pathname.split('/')[2],
                code: u.searchParams.get('pwd') || u.searchParams.get('passcode') || ''
            };
        } catch {
            return null;
        }
    }

    function hidden(el, root) {
        for (let n = el; n && n !== root.parentElement; n = n.parentElement) {
            if (n.hidden || n.getAttribute('aria-hidden') === 'true' || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(n.tagName)) return true;
            if (n.style && (n.style.display === 'none' || n.style.visibility === 'hidden')) return true;
            const view = n.ownerDocument.defaultView;
            if (n.isConnected && view) {
                const s = view.getComputedStyle(n);
                if (s.display === 'none' || s.visibility === 'hidden') return true;
            }
        }
        return false;
    }

    function codeFrom(text) {
        const label = text.match(/(?:提取码|提取密码|访问码|密码)\s*[:：]?\s*([a-zA-Z0-9]{4,8})(?![a-zA-Z0-9])/);
        if (label) return label[1];
        const bare = text.trim().match(/^[a-zA-Z0-9]{4,8}$/);
        return bare ? bare[0] : '';
    }

    // Traverse visible text and links in document order; pair codes only within their resource section.
    function extract(root) {
        if (!root) return [];
        const events = [];
        const walk = node => {
            if (node.nodeType === 3) {
                const s = node.textContent.trim();
                if (s) events.push({type: 'text', text: s});
                return;
            }
            if (node.nodeType !== 1 || hidden(node, root)) return;
            if (/^H[1-6]$/.test(node.tagName)) {
                if (!/^(提取码|提取密码|访问码|密码)\s*[:：]?$/.test(node.textContent.trim())) events.push({type: 'boundary'});
            }
            if (node.tagName === 'A') {
                const share = shareURL(node.getAttribute('href'));
                if (share) {
                    events.push({type: 'share', share});
                    return;
                }
            }
            for (const child of node.childNodes) walk(child);
            if (/^(P|DIV|BR|LI)$/.test(node.tagName)) events.push({type: 'break'});
        };
        walk(root);
        const resources = [];
        let section = [], last = null, text = '';
        const add = share => {
            let found = resources.find(r => r.provider === share.provider && r.id === share.id);
            if (!found) {
                found = {...share};
                resources.push(found);
            }
            if (share.code) found.code = share.code;
            if (!section.includes(found)) section.push(found);
            last = found;
        };
        const flush = () => {
            if (!text.trim()) return;
            const parts = text.split(/(https:\/\/pan\.(?:quark\.cn|baidu\.com)\/s\/[\w-]+(?:\?[^\s<>，。；）)]+)?)/g);
            for (const part of parts) {
                const share = shareURL(part.trim());
                if (share) {
                    add(share);
                    continue;
                }
                const code = codeFrom(part);
                if (!code) continue;
                let candidates = section;
                if (/夸克/.test(part)) candidates = section.filter(r => r.provider === 'quark');
                else if (/百度|度盘/.test(part)) candidates = section.filter(r => r.provider === 'baidu');
                // Several links followed by one standalone code is ambiguous; do not guess.
                const target = candidates.length === 1 ? candidates[0] : null;
                if (target && !target.code) target.code = code;
            }
            text = '';
        };
        for (const e of events) {
            if (e.type === 'text') text += ' ' + e.text;
            else if (e.type === 'share') {
                flush();
                add(e.share);
            } else if (e.type === 'boundary') {
                flush();
                section = [];
                last = null;
            } else flush();
        }
        flush();
        return resources.map(r => {
            const u = new URL(r.url);
            u.hash = '';
            if (r.code) u.searchParams.set('pwd', r.code);
            return {...r, url: u.href};
        });
    }

    function safeName(value) {
        return String(value).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/[.\s]+$/g, '').trim().slice(0, 100) || '未命名歌曲';
    }

    function isDir(item) {
        if (typeof item.dir === 'boolean') return item.dir;
        if (typeof item.file === 'boolean') return !item.file;
        throw new Error('网盘文件类型字段变化，已暂停');
    }

    function validJob(job, shareId, now = Date.now()) {
        return !!job && job.version === 1 && job.provider === 'quark' && job.shareId === shareId &&
            typeof job.id === 'string' && /^[a-f0-9-]{36}$/.test(job.id) &&
            Number.isFinite(job.created) && now >= job.created && now - job.created < 30 * 60 * 1000 &&
            /^\d+$/.test(job.threadId) && typeof job.title === 'string' &&
            typeof job.folder === 'string' && job.folder.length <= 120 && !/[\\/\u0000-\u001f]/.test(job.folder) &&
            typeof job.code === 'string' && /^(?:[a-zA-Z0-9]{4,8})?$/.test(job.code) &&
            (job.layout == null || ['direct', 'legacy'].includes(job.layout));
    }

    class Quark {
        constructor(request, pause = ms => new Promise(r => setTimeout(r, ms))) {
            this.request = request;
            this.pause = pause;
            this.last = 0;
        }

        async api(method, path, params = {}, body) {
            const wait = this.last + 350 - Date.now();
            if (wait > 0) await this.pause(wait);
            this.last = Date.now();
            const url = new URL('https://drive-pc.quark.cn/1/clouddrive' + path);
            url.search = new URLSearchParams({pr: 'ucpro', fr: 'pc', ...params}).toString();
            const res = await this.request(method, url.href, body);
            if (Number(res.status) !== 200 || String(res.code) !== '0') throw new Error(res.message || res.error_msg || '夸克请求被拒绝，请检查登录、提取码或安全验证');
            return res.data || {};
        }

        async list(path, params) {
            const all = [], seen = new Set();
            for (let page = 1; page <= 100; page++) {
                const data = await this.api('GET', path, {...params, _page: page, _size: 50, _fetch_total: 1});
                if (!Array.isArray(data.list)) throw new Error('网盘列表格式变化，已暂停');
                const list = data.list;
                if (!list.length) {
                    if (Number(data.metadata?._total || 0) > all.length) throw new Error('网盘分页未读完，已暂停');
                    return all;
                }
                for (const item of list) {
                    if (!item.fid || seen.has(item.fid)) throw new Error('网盘分页返回重复或无效项目，已暂停');
                    seen.add(item.fid);
                    all.push(item);
                }
                const total = Number(data.metadata?._total);
                if (Number.isFinite(total) && total > 0 && all.length >= total) return all;
                // Without total, keep reading until an empty page, even if a server caps page size.
            }
            throw new Error('目录过大，请使用网盘原页面处理');
        }

        mine(fid) {
            return this.list('/file/sort', {pdir_fid: fid});
        }

        async sameFolder(source, destination, shareId, stoken, budget = {items: 0, dirs: 0}, depth = 0) {
            if (depth > 8 || ++budget.dirs > 20) throw new Error('已有目录层级较深或项目较多，请在夸克手动核对');
            const original = await this.list('/share/sharepage/detail', {
                pwd_id: shareId,
                stoken,
                pdir_fid: source,
                _fetch_banner: 0,
                _fetch_share: 0
            });
            const saved = await this.mine(destination);
            budget.items += original.length + saved.length;
            if (budget.items > 400) throw new Error('已有目录项目较多，请在夸克手动核对');
            if (original.length !== saved.length) return false;
            if (new Set(original.map(f => f.file_name)).size !== original.length || new Set(saved.map(f => f.file_name)).size !== saved.length) return false;
            for (const file of original) {
                const hits = saved.filter(f => f.file_name === file.file_name);
                if (hits.length !== 1 || !file.file_name || isDir(file) !== isDir(hits[0])) return false;
                if (isDir(file)) {
                    if (!await this.sameFolder(file.fid, hits[0].fid, shareId, stoken, budget, depth + 1)) return false;
                } else if (file.size == null || hits[0].size == null || Number(file.size) !== Number(hits[0].size)) return false;
            }
            return true;
        }

        async folder(parent, name) {
            const items = await this.mine(parent);
            const hits = items.filter(i => i.file_name === name);
            if (hits.length > 1) throw new Error('目标目录有多个同名项目，请先在网盘整理');
            if (hits.length) {
                if (!isDir(hits[0])) throw new Error('目标路径已存在同名文件');
                return hits[0].fid;
            }
            const data = await this.api('POST', '/file', {}, {
                pdir_fid: parent,
                file_name: name,
                dir_path: '',
                dir_init_lock: false
            });
            if (!data.fid) throw new Error('新建目录结果不明确，请到网盘核对');
            return data.fid;
        }

        async poll(taskId) {
            for (let i = 0; i < 90; i++) {
                await this.pause(1000);
                const t = await this.api('GET', '/task', {task_id: taskId, retry_index: i});
                if (Number(t.status) === 2) return;
                if (Number(t.status) > 2) throw new Error('夸克转存任务失败，请到网盘核对');
            }
            throw new Error('转存仍未确认完成，请到网盘核对；不会自动重提任务');
        }

        async save(job, update) {
            if (job.taskId) {
                await this.poll(job.taskId);
                return {saved: job.count || 0, skipped: 0};
            }
            if (job.phase === 'saving' || job.phase === 'uncertain') throw new Error('上次转存结果不明确，请先在网盘核对，避免重复保存');
            update('读取分享内容…');
            const token = await this.api('POST', '/share/sharepage/token', {}, {
                pwd_id: job.shareId,
                passcode: job.code
            });
            if (!token.stoken) throw new Error('未获得分享访问权限，请检查提取码或手动完成验证');
            const files = await this.list('/share/sharepage/detail', {
                pwd_id: job.shareId,
                stoken: token.stoken,
                pdir_fid: '0',
                _fetch_banner: 0,
                _fetch_share: 0
            });
            if (!files.length) throw new Error('分享为空或已失效');
            if (files.length > 100) throw new Error('该分享超过 100 项，请到网盘手动选择');
            if (files.some(f => !f.share_fid_token || !f.file_name)) throw new Error('分享文件信息不完整，已暂停');
            update('定位保存目录…');
            const base = await this.folder('0', job.folder);
            // Preserve the destination of older interrupted jobs; new jobs save directly.
            const dest = job.layout === 'direct' ? base : await this.folder(base, safeName(job.title) + ' [' + job.threadId + ']');
            job.destination = dest;
            const existing = await this.mine(dest);
            const missing = [];
            for (const file of files) {
                const hits = existing.filter(f => f.file_name === file.file_name);
                if (!hits.length) {
                    missing.push(file);
                    continue;
                }
                let same = hits.length === 1 && isDir(file) === isDir(hits[0]);
                if (same && isDir(file)) {
                    update('检查已保存的文件…');
                    same = await this.sameFolder(file.fid, hits[0].fid, job.shareId, token.stoken);
                } else if (same) same = file.size != null && hits[0].size != null && Number(file.size) === Number(hits[0].size);
                if (!same) throw new Error('已存在“' + file.file_name + '”，但内容数量、类型或大小与分享不一致。已暂停，未覆盖文件；请在夸克核对。');
            }
            if (!missing.length) return {saved: 0, skipped: files.length};
            // Persist before mutating. An unknown response must never result in an automatic replay.
            job.phase = 'saving';
            job.count = missing.length;
            update('正在保存到夸克…', job);
            const data = await this.api('POST', '/share/sharepage/save', {}, {
                fid_list: missing.map(f => f.fid), fid_token_list: missing.map(f => f.share_fid_token),
                to_pdir_fid: dest, pwd_id: job.shareId, stoken: token.stoken, pdir_fid: '0', scene: 'link'
            });
            if (data.task_id != null && String(data.task_id)) {
                job.taskId = String(data.task_id);
                update('等待夸克确认…', job);
                await this.poll(job.taskId);
            } else {
                const check = await this.mine(dest);
                if (missing.some(f => isDir(f) || !check.some(t => t.file_name === f.file_name && !isDir(t) && f.size != null && t.size != null && Number(t.size) === Number(f.size)))) {
                    throw new Error('网盘未返回任务编号，且保存结果无法确认，请到网盘核对');
                }
            }
            return {saved: missing.length, skipped: files.length - missing.length};
        }
    }

    return {shareURL, extract, safeName, validJob, Quark};
})();
if (typeof module !== 'undefined' && module.exports) module.exports = HSave;

const STORE = 'hfs:v1:';
const get = (key, fallback) => GM_getValue(STORE + key, fallback);
const put = (key, value) => GM_setValue(STORE + key, value);
const remove = key => GM_deleteValue(STORE + key);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const stamp = () => Date.now();
const terminal = job => ['done', 'failed', 'uncertain'].includes(job?.phase);
const savedKey = (threadId, shareId, folder, layout = 'direct') => 'saved:' + layout + ':' + threadId + ':' + shareId + ':' + encodeURIComponent(folder);
let busy = false;
let refreshCoins = () => {
};

function el(tag, text = '', props = {}) {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    Object.assign(node, props);
    return node;
}

function coinBalance(doc) {
    for (const label of doc.querySelectorAll('span.text-muted')) {
        if (!/^金币[：:]$/.test(label.textContent.trim())) continue;
        const amount = label.nextElementSibling;
        if (amount?.tagName !== 'EM') continue;
        const value = amount.textContent.trim().replaceAll(',', '');
        if (/^\d+(?:\.\d+)?$/.test(value)) return value;
    }
    return null;
}

function coins(box) {
    const badge = el('button', '金币 …', {type: 'button', className: 'hfs-coins', title: '点击刷新金币余额'});
    box.querySelector('.hfs-head').insertBefore(badge, box.querySelector('.fold'));
    let loading = false;
    // Validation failures intentionally share the network-error UI and finally cleanup.
    refreshCoins = async () => {
        if (loading) return;
        const account = signAccount(document);
        if (!account) {
            badge.textContent = '金币 —';
            badge.title = '登录 HiFiTi 后显示余额';
            return;
        }
        loading = true;
        badge.disabled = true;
        try {
            let doc = !badge.dataset.loaded && location.pathname === '/my.htm' ? document : null;
            badge.dataset.loaded = 'true';
            if (!doc || coinBalance(doc) === null) {
                const response = await fetch(new URL('/my.htm', location.origin).href, {
                    credentials: 'same-origin',
                    cache: 'no-store',
                    signal: AbortSignal.timeout(20000)
                });
                if (!response.ok || new URL(response.url).origin !== location.origin) {
                    // noinspection ExceptionCaughtLocallyJS
                    throw new Error('无法读取余额');
                }
                doc = new DOMParser().parseFromString(await response.text(), 'text/html');
            }
            if (signAccount(document) !== account || signAccount(doc) !== account) {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error('登录状态发生变化');
            }
            const amount = coinBalance(doc);
            if (amount === null) {
                // noinspection ExceptionCaughtLocallyJS
                throw new Error('官网未返回金币余额');
            }
            badge.textContent = '金币 ' + amount;
            badge.title = '官网余额 · 点击刷新';
        } catch {
            badge.textContent = '金币 —';
            badge.title = '余额读取失败，点击重试';
        } finally {
            loading = false;
            badge.disabled = false;
        }
    };
    badge.onclick = () => refreshCoins();
    refreshCoins();
}

function panel(mode = 'forum') {
    const style = el('style');
    style.textContent = `
    #hfs-panel{--ink:#212529;--muted:#868e96;--accent:#5f8ece;--line:#dee2e6;position:fixed;right:24px;bottom:24px;z-index:2147483000;width:320px;max-width:calc(100vw - 24px);max-height:calc(100dvh - 48px);display:flex;flex-direction:column;background:#fff;color:var(--ink);border:1px solid rgba(0,0,0,.125);border-radius:3px;box-shadow:0 1px 3px #1a1a1a1a;font:14px/1.5 'Helvetica Neue',Helvetica,'Microsoft Yahei','Hiragino Sans GB','WenQuanYi Micro Hei',sans-serif;text-align:left;overflow:hidden;isolation:isolate;color-scheme:light}
    #hfs-panel *,#hfs-panel *:before,#hfs-panel *:after{box-sizing:border-box}#hfs-panel [hidden]{display:none!important}#hfs-panel p{margin:0}#hfs-panel button,#hfs-panel input{font:inherit;letter-spacing:normal;text-transform:none;line-height:1.5}#hfs-panel button{cursor:pointer;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid #ced4da;border-radius:3px;padding:5px 10px;background:#fff;color:#495057;margin:0;box-shadow:none;transition:background .15s,border-color .15s}#hfs-panel button:hover:not(:disabled){background:#e9ecef;border-color:#adb5bd}#hfs-panel button:focus{outline:none}#hfs-panel button:focus-visible,#hfs-panel input:focus-visible{outline:2px solid #80adE8;outline-offset:2px}#hfs-panel button:disabled{opacity:.55;cursor:default}#hfs-panel .primary{background:var(--accent);color:#fff;border-color:var(--accent);width:100%;padding:7px 10px;font-weight:400}#hfs-panel .primary:hover:not(:disabled){background:#4378bf;border-color:#4378bf}
    #hfs-panel .hfs-head{padding:9px 14px;display:flex;align-items:center;gap:8px;background:#f6f6f6;border-bottom:1px solid #e9ecef;color:#454d55}#hfs-panel .hfs-brand{flex:1;min-width:0}#hfs-panel .hfs-coins{padding:2px 0;border:0;background:transparent;color:#868e96;font-size:12px;white-space:nowrap}#hfs-panel .hfs-coins:hover:not(:disabled){color:var(--accent);background:transparent}#hfs-panel.hfs-folded .hfs-coins{display:none}#hfs-panel strong{display:block;font-size:14px;letter-spacing:normal;font-weight:500}#hfs-panel .fold{width:24px;height:24px;padding:0;border:0;background:transparent;font-size:18px;color:#868e96}#hfs-panel.hfs-folded{width:150px}#hfs-panel.hfs-folded .hfs-head{padding:7px 10px;border:0}
    #hfs-panel .hfs-tabs{display:flex;flex-shrink:0;gap:0;margin:0;padding:0 12px;background:#fff;border-bottom:1px solid var(--line)}#hfs-panel .hfs-tab{flex:1;padding:10px 2px 8px;border:0;border-bottom:2px solid transparent;margin-bottom:-1px;background:transparent;color:#868e96;font-size:13px;border-radius:0;white-space:nowrap;font-weight:400;transition:color .12s ease,background-color .12s ease}#hfs-panel .hfs-tab:focus-visible{outline:none;box-shadow:inset 0 0 0 2px #b8d1f2}#hfs-panel .hfs-tab:hover:not(:disabled){background:#f8f9fa;border-color:transparent;border-bottom-color:#ced4da}#hfs-panel .hfs-tab[aria-selected=true],#hfs-panel .hfs-tab[aria-selected=true]:hover:not(:disabled){color:var(--accent);border-bottom-color:var(--accent);background:transparent;font-weight:400}#hfs-panel .hfs-body{min-height:0;max-height:min(640px,calc(100dvh - 150px));overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}#hfs-panel .hfs-pane{padding:14px}#hfs-panel .hfs-muted{font-size:12px;color:var(--muted);line-height:1.6}#hfs-panel .hfs-status{padding:8px 10px;background:#f2f6fc;border:1px solid #d6e2f3;border-radius:3px;margin:0 0 12px;color:#456286;font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}#hfs-panel .hfs-status.error{background:#fff3cd;border-color:#ffeeba;color:#856404}#hfs-panel .hfs-actions{display:flex;flex-direction:column;gap:8px}#hfs-panel .hfs-toolbar{display:flex;align-items:center;justify-content:space-between;margin:0 0 8px;gap:8px}#hfs-panel .hfs-section-label{font-size:12px;font-weight:400;color:var(--muted)}#hfs-panel .hfs-link-button{font-size:12px;padding:2px 0;border:0;background:transparent;color:var(--accent)}#hfs-panel .hfs-link-button:hover:not(:disabled){background:transparent;color:#3465a5;text-decoration:underline}#hfs-panel .hfs-resources{display:flex;flex-direction:column;gap:6px}#hfs-panel .hfs-choice{width:100%;justify-content:space-between;text-align:left;padding:8px 10px;background:#fff;border-color:var(--line)}#hfs-panel .hfs-choice[aria-pressed=true]{border-color:var(--accent);background:#f5f8fc}#hfs-panel .hfs-provider{font-weight:400;display:block;font-size:14px}#hfs-panel .hfs-resource-meta{display:block;font-size:12px;color:var(--muted);font-weight:400;margin-top:2px}#hfs-panel .hfs-choice[aria-pressed=false] .hfs-resource-arrow{opacity:0}#hfs-panel .hfs-resource-arrow{color:var(--accent);font-size:16px}#hfs-panel .hfs-destination{margin-top:12px;padding:10px 0 0;border-top:1px solid #e9ecef;font-size:12px;color:var(--muted);overflow-wrap:anywhere}#hfs-panel .hfs-destination b{font-weight:400;color:#495057}#hfs-panel .hfs-empty{padding:10px;border:1px dashed #ced4da;border-radius:3px;font-size:12px;color:var(--muted)}
    #hfs-panel label{display:block;font-size:14px;color:#495057}#hfs-panel input:not([type=checkbox]){display:block;width:100%;padding:5px 10px;margin:6px 0 0;border:1px solid #ced4da;border-radius:3px;background:white;color:#495057;min-width:0}#hfs-panel .hfs-field{margin-top:14px}#hfs-panel .hfs-field:first-child{margin-top:0}#hfs-panel .hfs-field-help{margin-top:6px;font-size:12px;color:var(--muted)}#hfs-panel .hfs-settings-save{margin-top:16px;width:100%;background:var(--accent);border-color:var(--accent);color:#fff}#hfs-panel .hfs-settings-save:hover:not(:disabled){background:#4378bf;border-color:#4378bf}#hfs-panel .hfs-settings-result{margin-top:8px;font-size:12px;color:#367047}#hfs-panel .hfs-settings-result:empty{display:none}#hfs-panel .hfs-settings-result.error{color:#856404}#hfs-panel .hfs-sign-card{padding:10px;background:#f8f9fa;border:1px solid #e9ecef;border-radius:3px;margin:0 0 12px}#hfs-panel .hfs-sign-card [role=status]{font-size:14px;font-weight:400;color:#495057;overflow-wrap:anywhere}#hfs-panel .hfs-switch-row{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:14px 0}#hfs-panel .hfs-switch-row label{flex:1;font-size:14px;color:var(--ink)}#hfs-panel .hfs-switch-row input{appearance:auto;display:block;flex-shrink:0;width:16px;height:16px;accent-color:var(--accent);cursor:pointer;margin:0}#hfs-panel #hfs-sign>button{width:100%}#hfs-panel .hfs-job-title{padding:10px;background:#f8f9fa;border:1px solid #e9ecef;border-radius:3px;font-size:12px;font-weight:400;overflow-wrap:anywhere;margin-bottom:12px}
    @media(max-width:480px){#hfs-panel{right:12px;bottom:12px;width:calc(100vw - 24px);max-width:320px;max-height:calc(100dvh - 24px)}#hfs-panel .hfs-body{max-height:calc(100dvh - 135px)}}@media(prefers-reduced-motion:reduce){#hfs-panel *,#hfs-panel *:after{transition:none!important}}
  `;
    document.head.append(style);
    const box = el('aside', '', {id: 'hfs-panel'});
    box.setAttribute('aria-label', 'HiFiTi 助手');
    const head = el('div', '', {className: 'hfs-head'});
    const brand = el('div', '', {className: 'hfs-brand'});
    brand.append(el('strong', 'HiFiTi 助手'));
    head.append(brand);
    const fold = el('button', '−', {className: 'fold', type: 'button'});
    head.append(fold);
    const body = el('div', '', {className: 'hfs-body'});
    const tabs = el('div', '', {className: 'hfs-tabs'});
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', '助手功能');
    const panes = {}, tabButtons = {};
    const entries = mode === 'quark' ? [['save', '转存进度']] : mode === 'home' ? [['sign', '每日签到'], ['settings', '偏好设置']] : [['save', '资源保存'], ['sign', '每日签到'], ['settings', '偏好设置']];
    const selectTab = name => {
        for (const [key] of entries) {
            panes[key].hidden = key !== name;
            tabButtons[key].setAttribute('aria-selected', String(key === name));
            tabButtons[key].tabIndex = key === name ? 0 : -1;
        }
        body.scrollTop = 0;
    };
    for (const [name, title] of entries) {
        const pane = el('section', '', {id: 'hfs-pane-' + name, className: 'hfs-pane'});
        pane.setAttribute('role', 'tabpanel');
        pane.setAttribute('aria-labelledby', 'hfs-tab-' + name);
        const tab = button(tabs, title, () => selectTab(name));
        tab.className = 'hfs-tab';
        tab.id = 'hfs-tab-' + name;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', pane.id);
        panes[name] = pane;
        tabButtons[name] = tab;
        body.append(pane);
        tab.onkeydown = event => {
            const index = entries.findIndex(([key]) => key === name);
            const next = event.key === 'ArrowRight' ? (index + 1) % entries.length : event.key === 'ArrowLeft' ? (index + entries.length - 1) % entries.length : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : -1;
            if (next >= 0) {
                event.preventDefault();
                selectTab(entries[next][0]);
                tabButtons[entries[next][0]].focus();
            }
        };
    }
    const save = panes.save;
    const status = el('div', '准备就绪', {className: 'hfs-status'});
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const actions = el('div', '', {className: 'hfs-actions'});
    if (save) save.append(status, actions);
    brand.title = 'v1.0.0';
    box.append(head, tabs, body);
    document.body.append(box);
    if (mode !== 'quark') coins(box);
    if (entries.length === 1) tabs.hidden = true;
    selectTab(entries[0][0]);
    const setFold = value => {
        body.hidden = value;
        tabs.hidden = value || entries.length === 1;
        box.classList.toggle('hfs-folded', value);
        fold.textContent = value ? '+' : '−';
        fold.setAttribute('aria-expanded', String(!value));
        fold.setAttribute('aria-label', value ? '展开面板' : '收起面板');
        fold.title = value ? '展开面板' : '收起面板';
    };
    setFold(get('panelFolded', false));
    fold.onclick = () => {
        const value = !body.hidden;
        setFold(value);
        put('panelFolded', value);
    };
    return {
        box,
        body,
        save,
        settings: panes.settings,
        sign: panes.sign,
        actions,
        status,
        selectTab,
        say(message, error = false) {
            status.textContent = message;
            status.hidden = !message;
            status.classList.toggle('error', error);
        }
    };
}

function button(parent, text, action, primary = false) {
    const b = el('button', text, {type: 'button', className: primary ? 'primary' : ''});
    b.onclick = action;
    parent.append(b);
    return b;
}

function settings(ui) {
    const details = ui.settings;
    const folderLabel = el('label', '保存文件夹', {className: 'hfs-field'});
    const folder = el('input', '', {value: get('folder', 'HiFiTi音乐'), maxLength: 100});
    folderLabel.append(folder);
    folderLabel.append(el('p', '位于夸克根目录，直接保存分享中的文件或文件夹。', {className: 'hfs-field-help'}));
    const replyLabel = el('label', '解锁评论', {className: 'hfs-field'});
    const reply = el('input', '', {value: get('reply', '感谢分享。'), maxLength: 200});
    replyLabel.append(reply);
    replyLabel.append(el('p', '仅在你点击回帖保存时发表，预计扣 1 金币。', {className: 'hfs-field-help'}));
    details.append(folderLabel, replyLabel);
    const feedback = el('p', '', {className: 'hfs-settings-result'});
    feedback.setAttribute('role', 'status');
    const save = button(details, '保存设置', () => {
        if (!folder.value.trim() || !reply.value.trim()) {
            feedback.textContent = '目录和评论不能为空';
            feedback.classList.add('error');
            return;
        }
        folder.value = HSave.safeName(folder.value);
        put('folder', folder.value);
        put('reply', reply.value.trim());
        feedback.classList.remove('error');
        feedback.textContent = '设置已保存，下次转存生效。';
        const path = ui.box.querySelector('[data-hfs-folder]');
        if (path) path.textContent = '/' + folder.value + '/';
    });
    save.classList.add('hfs-settings-save');
    details.append(feedback);
}

function request(method, url, body) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method, url, timeout: 30000,
            headers: {'Content-Type': 'application/json', 'Referer': 'https://pan.quark.cn/'},
            data: body == null ? undefined : JSON.stringify(body),
            onload(response) {
                if (response.status < 200 || response.status >= 300) return reject(new Error('夸克返回 HTTP ' + response.status + '，请检查登录或安全验证'));
                try {
                    resolve(JSON.parse(response.responseText));
                } catch {
                    reject(new Error('夸克返回了非预期页面，请先手动登录或完成安全验证'));
                }
            },
            onerror: () => reject(new Error('夸克网络请求失败，请检查网络及网页版登录状态')),
            ontimeout: () => reject(new Error('请求超时，结果可能不明确，请先到网盘核对'))
        });
    });
}

function content(doc = document) {
    return doc.querySelector('#thread-content');
}

function locked(doc = document) {
    return !!content(doc)?.querySelector('.alert-warning .post_reply');
}

async function readPost() {
    const res = await fetch(location.href, {credentials: 'same-origin', cache: 'no-store'});
    if (!res.ok) throw new Error('读取帖子失败，请刷新官网后重试');
    if (new URL(res.url).origin !== location.origin) throw new Error('网站跳转了，请手动检查登录或验证');
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    if (!content(doc)) throw new Error('未读到帖子正文，请手动检查官网验证或登录状态');
    return doc;
}

function forum() {
    const threadId = location.pathname.match(/^\/thread-(\d+)/)?.[1];
    if (!threadId || !content()) return;
    const ui = panel();
    const choices = el('div', '', {className: 'hfs-resources'});
    const primary = button(ui.actions, '', () => run(), true);
    const toolbar = el('div', '', {className: 'hfs-toolbar'});
    const resourceCount = el('span', '可用资源', {className: 'hfs-section-label'});
    toolbar.append(resourceCount);
    const refresh = button(toolbar, '重新读取资源', () => inspect());
    refresh.className = 'hfs-link-button';
    ui.save.append(toolbar, choices, ui.actions);
    ui.actions.style.marginTop = '14px';
    const destination = el('p', '保存位置  ', {className: 'hfs-destination'});
    const path = el('b', '/' + get('folder', 'HiFiTi音乐') + '/');
    path.setAttribute('data-hfs-folder', '');
    destination.append(path);
    ui.save.append(destination);
    settings(ui);
    let selected = null, lastDoc = document;
    const pendingKey = 'post:' + threadId;
    const receipt = () => selected && get(savedKey(threadId, selected.id, HSave.safeName(get('folder', 'HiFiTi音乐'))), null);

    function reopenReady(job) {
        if (job?.phase !== 'ready' || !HSave.validJob(job, job.shareId) || job.threadId !== threadId) return false;
        if (!job.lease || stamp() - job.lease >= 3 * 60 * 1000) {
            job.layout = 'direct';
            put('job:' + job.id, job);
        }
        const url = new URL('https://pan.quark.cn/s/' + job.shareId);
        if (job.code) url.searchParams.set('pwd', job.code);
        url.searchParams.set('hfs_job', job.id);
        GM_openInTab(url.href, {active: true, insert: true, setParent: true});
        ui.say('已重新打开尚未开始的夸克任务；不会重复评论。');
        return true;
    }

    const updateLabel = () => {
        primary.textContent = locked(lastDoc) ? '回帖并存到夸克 · 预计 1 金币' : receipt() ? '检查并保存' : '存到夸克';
        const old = get(pendingKey, null);
        if (old?.phase === 'reply-submitted') primary.textContent = '检查解锁结果并继续';
        primary.disabled = busy;
    };
    const track = id => {
        const show = job => {
            if (!job) return;
            const legacyConflict = job.message?.includes('目标目录存在同名项目');
            ui.say(legacyConflict ? '保存位置已有同名内容。点击“检查并保存”核对，匹配的文件会跳过。' : job.message || '等待网盘…', !legacyConflict && ['failed', 'uncertain'].includes(job.phase));
            if (legacyConflict) primary.textContent = '检查并保存';
            if (job.phase === 'done') {
                put(savedKey(threadId, job.shareId, job.folder, job.layout || 'legacy'), {
                    at: stamp(),
                    destination: job.destination
                });
                remove(pendingKey);
                updateLabel();
            }
        };
        GM_addValueChangeListener(STORE + 'job:' + id, (_key, _old, value) => show(value));
        show(get('job:' + id, null));
    };

    function render(doc) {
        lastDoc = doc;
        choices.replaceChildren();
        const resources = HSave.extract(content(doc)).sort((a, b) => Number(b.provider === 'quark') - Number(a.provider === 'quark'));
        const quarks = resources.filter(r => r.provider === 'quark');
        selected = quarks.find(r => r.id === selected?.id) || (quarks.length === 1 ? quarks[0] : null);
        resourceCount.textContent = '分享资源 · ' + resources.length;
        for (const [index, r] of resources.entries()) {
            const cardContent = el('span');
            cardContent.append(el('span', r.provider === 'quark' ? '夸克网盘' + (quarks.length > 1 ? ' · ' + (index + 1) : '') : '百度网盘', {className: 'hfs-provider'}), el('span', (r.code ? '提取码已就绪' : '未识别到提取码') + (r.provider === 'baidu' ? ' · 手动转存' : ' · 自动转存'), {className: 'hfs-resource-meta'}));
            if (r.provider === 'quark') {
                const b = button(choices, '', () => {
                    selected = r;
                    for (const option of choices.querySelectorAll('[aria-pressed]')) option.setAttribute('aria-pressed', String(option === b));
                    updateLabel();
                    ui.say(receipt() ? '上次已保存。再次检查时会跳过名称、大小一致的内容。' : '');
                });
                b.append(cardContent, el('span', '✓', {className: 'hfs-resource-arrow'}));
                b.setAttribute('aria-pressed', String(selected?.id === r.id));
                b.className = 'hfs-choice';
                b.disabled = locked(doc);
            } else {
                const b = button(choices, '', () => GM_openInTab(r.url, {active: true, insert: true, setParent: true}));
                b.className = 'hfs-choice';
                b.append(cardContent, el('span', '↗', {className: 'hfs-resource-arrow'}));
            }
        }
        if (!resources.length) choices.append(el('p', locked(doc) ? '回帖解锁后，资源会显示在这里。' : '暂未找到资源，可以重新读取。', {className: 'hfs-empty'}));
        updateLabel();
        return {resources, quarks};
    }

    async function inspect() {
        if (busy) return;
        busy = true;
        updateLabel();
        try {
            ui.say('读取当前账号可见的资源…');
            const doc = await readPost();
            render(doc);
            ui.say(locked(doc) ? '资源尚未解锁。保存时将发表评论，预计扣 1 金币。' : receipt() ? '上次已保存。可再次检查，已有内容会跳过。' : '');
        } catch (e) {
            ui.say(e.message, true);
        } finally {
            busy = false;
            updateLabel();
            refreshCoins();
        }
    }

    async function openResource(resource) {
        const active = get(pendingKey, null);
        if (active?.jobId) {
            const old = get('job:' + active.jobId, null);
            if (old && !terminal(old) && stamp() - old.created < 30 * 60 * 1000) {
                track(old.id);
                if (reopenReady(old)) return;
                ui.say('已有转存任务，请在已打开的夸克标签页继续；不会重复提交。');
                return;
            }
            if (old?.phase === 'uncertain' || old?.phase === 'saving') throw new Error('上次保存结果不明确，请先在夸克页面核对，勿重复保存。');
        }
        const id = crypto.randomUUID();
        const job = {
            version: 1, id, threadId, provider: 'quark', shareId: resource.id, layout: 'direct',
            code: resource.code, created: stamp(), phase: 'ready',
            title: document.querySelector('h4')?.textContent.trim() || '歌曲',
            folder: HSave.safeName(get('folder', 'HiFiTi音乐')), message: '等待夸克标签页接力…'
        };
        put('job:' + id, job);
        put(pendingKey, {phase: 'opened', jobId: id, created: stamp()});
        track(id);
        // Quark replaces the hash with its SPA route before document-idle scripts run.
        const url = new URL(resource.url);
        url.searchParams.set('hfs_job', id);
        GM_openInTab(url.href, {active: true, insert: true, setParent: true});
        ui.say('已打开夸克，正在接力保存；本页会显示结果。');
    }

    async function run() {
        if (busy) return;
        if (!navigator.locks) return ui.say('当前浏览器不支持任务锁，请使用最新版 Edge。', true);
        return navigator.locks.request('hfs-post-' + threadId, {ifAvailable: true}, lock => {
            if (!lock) return ui.say('这个帖子正在另一个标签页处理，请勿重复提交。');
            return runLocked();
        });
    }

    // Validation failures intentionally share the error UI and release busy in finally.
    async function runLocked() {
        if (busy) return;
        busy = true;
        updateLabel();
        try {
            let doc = lastDoc;
            const prior = get(pendingKey, null);
            if (prior?.jobId) {
                const job = get('job:' + prior.jobId, null);
                if (job && !terminal(job) && stamp() - job.created < 30 * 60 * 1000) {
                    if (reopenReady(job)) {
                        track(job.id);
                        return;
                    }
                    track(job.id);
                    ui.say('已有任务，请到已打开的夸克页面查看进度。');
                    return;
                }
            }
            if (locked(doc)) {
                // Re-read before any comment so stale pages do not double-spend a coin.
                doc = await readPost();
                if (locked(doc)) {
                    if (prior?.phase === 'reply-submitted') {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new Error('此前已经提交过评论，但还未确认解锁。请在官网查看结果；脚本不会自动再次评论。');
                    }
                    const form = document.querySelector('#quick_reply_form');
                    const input = form?.querySelector('#message');
                    const submit = form?.querySelector('#submit');
                    if (!form || !input || !submit || submit.disabled) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new Error('没有可用的回帖表单，请先在官网登录或完成验证');
                    }
                    if (input.value.trim()) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new Error('回帖框已有你的草稿，请先处理草稿，脚本不会覆盖');
                    }
                    const action = new URL(form.getAttribute('action'), location.href);
                    if (action.origin !== location.origin || !new RegExp('^/post-create-' + threadId + '(?:-\\d+)?\\.htm$').test(action.pathname)) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new Error('回帖表单地址发生变化，已暂停');
                    }
                    const reply = get('reply', '感谢分享。');
                    if (!reply.trim()) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new Error('请先设置回帖内容');
                    }
                    put(pendingKey, {phase: 'reply-submitted', created: stamp()});
                    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
                    setter.call(input, reply);
                    input.dispatchEvent(new Event('input', {bubbles: true}));
                    input.dispatchEvent(new Event('change', {bubbles: true}));
                    submit.click();
                    ui.say('已提交评论，等待网站确认解锁…');
                    // GET only. Never repeat a POST after timeout or reload.
                    for (let i = 0; i < 6; i++) {
                        await sleep(2000);
                        doc = await readPost();
                        if (!locked(doc)) break;
                    }
                    if (locked(doc)) {
                        // noinspection ExceptionCaughtLocallyJS
                        throw new Error('尚未确认解锁，请手动检查官网评论或验证提示；不会重复回帖。');
                    }
                }
            }
            const chosenId = selected?.id;
            const {quarks, resources} = render(doc);
            if (chosenId) selected = quarks.find(r => r.id === chosenId) || selected;
            if (!quarks.length) {
                remove(pendingKey);
                ui.say(resources.length ? '该帖没有夸克资源，可使用下方百度带码入口。' : '未找到可用的夸克或百度分享链接，请在正文核对。', true);
                return;
            }
            if (!selected) {
                ui.say('该帖有多个夸克资源，请点击下方需要保存的那一个。');
                return;
            }
            await openResource(selected);
        } catch (e) {
            ui.say(e.message, true);
        } finally {
            busy = false;
            updateLabel();
        }
    }

    render(document);
    const existing = get(pendingKey, null);
    if (existing?.jobId) track(existing.jobId);
    else if (existing?.phase === 'reply-submitted') {
        ui.say('此前已提交评论，正在检查解锁结果…');
        void run(); // This branch can only GET and continue, never submit a second comment.
    } else ui.say(locked() ? '将发表「' + get('reply', '感谢分享。') + '」，预计扣 1 金币。' : receipt() ? '上次已保存。可再次检查，已有内容会跳过。' : '');
}

function quark() {
    const id = new URLSearchParams(location.search).get('hfs_job') || new URLSearchParams(location.hash.slice(1)).get('hfs-job');
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) return;
    const shareId = location.pathname.match(/^\/s\/([\w-]+)/)?.[1];
    let job = get('job:' + id, null);
    if (!HSave.validJob(job, shareId)) return;
    const ui = panel('quark');
    ui.save.insertBefore(el('p', job.title, {className: 'hfs-job-title'}), ui.status);
    const saveJob = message => {
        job.message = message;
        put('job:' + id, {...job});
        ui.say(message);
    };
    const target = el('p', '保存到 /' + job.folder + '/' + (job.layout === 'direct' ? '' : HSave.safeName(job.title) + ' [' + job.threadId + ']/'), {className: 'hfs-destination'});
    ui.save.append(target);
    const codeLabel = el('label', '提取码（登录或验证完成后可补填）');
    codeLabel.className = 'hfs-field';
    const code = el('input', '', {value: job.code, maxLength: 8});
    codeLabel.append(code);
    ui.save.append(codeLabel);
    const retry = button(ui.actions, '我已登录 / 完成验证，继续', () => start(), true);
    button(ui.actions, '打开我的夸克网盘', () => GM_openInTab('https://pan.quark.cn/', {active: true, insert: true}));

    async function start() {
        if (!navigator.locks) return ui.say('当前浏览器不支持任务锁，请使用最新版 Edge。', true);
        return navigator.locks.request('hfs-quark-save', {ifAvailable: true}, lock => {
            if (!lock) return ui.say('另一项夸克转存正在执行，完成后请点击继续。');
            return execute();
        });
    }

    async function execute() {
        if (busy || job.phase === 'done') return;
        const fresh = get('job:' + id, null);
        if (!HSave.validJob(fresh, shareId)) return ui.say('任务已过期，请回歌曲页面重新发起。', true);
        if (fresh.lease && stamp() - fresh.lease < 3 * 60 * 1000) return ui.say('该任务正在另一个页面执行，请等待或到那个标签页查看。', true);
        job = fresh;
        if (!/^(?:[a-zA-Z0-9]{4,8})?$/.test(code.value.trim())) return ui.say('提取码格式不正确', true);
        job.code = code.value.trim();
        job.lease = stamp();
        put('job:' + id, {...job});
        busy = true;
        retry.disabled = true;
        code.disabled = true;
        const heartbeat = setInterval(() => {
            job.lease = stamp();
            put('job:' + id, {...job});
        }, 30000);
        try {
            const api = new HSave.Quark(request);
            const result = await api.save(job, message => saveJob(message));
            job.phase = 'done';
            job.lease = 0;
            put(savedKey(job.threadId, job.shareId, job.folder, job.layout || 'legacy'), {
                at: stamp(),
                destination: job.destination
            });
            saveJob(result.saved ? `已保存到夸克：${result.saved} 项${result.skipped ? '，跳过已有内容 ' + result.skipped + ' 项' : ''}。` : '已保存，未重复转存。已按文件名和大小核对现有内容。');
            retry.textContent = '保存完成';
        } catch (e) {
            job.phase = job.phase === 'saving' || job.taskId ? 'uncertain' : 'failed';
            job.lease = 0;
            saveJob(e.message);
            ui.say(e.message, true);
            retry.disabled = job.phase === 'uncertain' && !job.taskId;
            retry.textContent = job.taskId ? '只查询上次任务结果' : '我已登录 / 完成验证，继续';
        } finally {
            clearInterval(heartbeat);
            job.lease = 0;
            put('job:' + id, {...job});
            busy = false;
            code.disabled = false;
            if (job.phase !== 'done' && !(job.phase === 'uncertain' && !job.taskId)) retry.disabled = false;
        }
    }

    if (job.phase === 'done') {
        ui.say(job.message);
        retry.textContent = '保存完成';
        retry.disabled = true;
    } else if (job.phase === 'ready') void start();
    else {
        ui.say(job.message || '任务曾中断。可继续查询，或先在网盘核对。', true);
        if (job.phase === 'saving' && !job.taskId || job.phase === 'uncertain' && !job.taskId) retry.disabled = true;
    }
}

function signAccount(doc) {
    return [...doc.querySelectorAll('header a[href], #header a[href]')]
        .find(a => new URL(a.getAttribute('href'), location.origin).pathname === '/my.htm')?.textContent.trim() || '';
}

function signState(doc) {
    if (!doc.querySelector('#sg_sign #sign')) return null;
    // The server renders a placeholder and sets the actual label in an inline script.
    // Read the literal label only; never execute scripts from fetched HTML.
    for (const script of doc.querySelectorAll('script')) {
        if (!script.textContent.includes("$('#sg_sign')")) continue;
        const label = script.textContent.match(/\bvar\s+s1\s*=\s*(['"])(已签|签到)\1\s*;/)?.[2];
        if (label) return label === '已签';
    }
    const label = doc.querySelector('#sg_sign #sign').textContent.trim();
    return label === '已签' ? true : label === '签到' ? false : null;
}

function signDay() {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

function autoSign() {
    const existing = document.querySelector('#hfs-panel');
    const ui = existing ? {sign: existing.querySelector('#hfs-pane-sign')} : panel('home');
    if (!existing) settings(ui);
    const section = el('section');
    section.id = 'hfs-sign';
    const card = el('div', '', {className: 'hfs-sign-card'});
    const status = el('p', '正在检查签到状态…');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    card.append(status);
    section.append(card);
    const switchRow = el('div', '', {className: 'hfs-switch-row'});
    const label = el('label', '每天访问网站时自动签到');
    label.htmlFor = 'hfs-auto-sign';
    const enabled = el('input', '', {id: 'hfs-auto-sign', type: 'checkbox', checked: get('autoSign', true)});
    switchRow.append(label, enabled);
    section.append(switchRow);
    ui.sign.append(section);
    let running = false;
    const retry = button(section, '检查 / 重试签到', () => run(true));
    section.append(el('p', '按北京时间计日 · 关闭浏览器时不运行', {className: 'hfs-field-help'}));
    enabled.onchange = () => {
        put('autoSign', enabled.checked);
        if (enabled.checked) void run();
        else status.textContent = '自动签到已关闭';
    };

    async function page() {
        const response = await fetch(new URL('/sg_sign.htm', location.origin).href, {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(20000)
        });
        if (!response.ok || new URL(response.url).origin !== location.origin) throw new Error('无法读取签到页面，请在官网检查登录或验证');
        return new DOMParser().parseFromString(await response.text(), 'text/html');
    }

    async function run(manual = false) {
        if (running || (!manual && !enabled.checked)) {
            if (!running) status.textContent = '自动签到已关闭';
            return;
        }
        const account = signAccount(document);
        if (!account) {
            status.textContent = '登录 HiFiTi 后才能自动签到';
            return;
        }
        if (!navigator.locks) {
            status.textContent = '自动签到需要最新版 Edge 的任务锁支持';
            return;
        }
        running = true;
        retry.disabled = true;
        try {
            await navigator.locks.request('hfs-daily-sign', {ifAvailable: true}, async lock => {
                if (!lock) {
                    status.textContent = '另一个标签页正在检查签到';
                    return;
                }
                const day = signDay(), key = 'sign:' + encodeURIComponent(account) + ':' + day;
                const old = get(key, null);
                if (old?.done) {
                    status.textContent = day + ' · 今日已签到';
                    return;
                }
                if (old && !manual) {
                    status.textContent = old.message || '今天已尝试签到；可点击检查 / 重试';
                    return;
                }
                status.textContent = '正在检查今日签到…';
                let doc = await page();
                if (signAccount(doc) !== account) throw new Error('登录状态发生变化，请刷新官网后重试');
                const state = signState(doc);
                if (state === null) throw new Error('签到页面结构变化或需要验证，请到官网手动检查');
                if (!state) {
                    // Persist before POST: reloads and additional tabs never repeat an uncertain submission.
                    put(key, {done: false, message: '今天已发起签到；结果不明确时请点击检查 / 重试'});
                    if (!enabled.checked && !manual) {
                        status.textContent = '自动签到已关闭';
                        return;
                    }
                    const form = doc.querySelector('form#sg_sign, form#sg_sign_mobile');
                    const data = new URLSearchParams();
                    if (form) {
                        for (const [name, value] of new FormData(form)) {
                            data.append(name, typeof value === 'string' ? value : String(value));
                        }
                    }
                    const response = await fetch(new URL('/sg_sign.htm', location.origin).href, {
                        method: 'POST', credentials: 'same-origin', cache: 'no-store',
                        signal: AbortSignal.timeout(20000),
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                            'X-Requested-With': 'XMLHttpRequest'
                        }, body: data.toString()
                    });
                    if (!response.ok || new URL(response.url).origin !== location.origin) throw new Error('签到请求未确认，请手动检查官网');
                    const result = await response.json();
                    if (String(result.code) !== '0' && !/已签|已经签到|重复签到/.test(String(result.message))) throw new Error('签到未完成，请在官网检查登录或验证');
                    doc = await page();
                    if (signAccount(doc) !== account || signState(doc) !== true) throw new Error('尚未确认签到成功，请到官网核对后重试');
                }
                put(key, {done: true});
                refreshCoins();
                status.textContent = day + ' · 今日已签到';
                const nativeLabel = document.querySelector('#sg_sign #sign');
                if (nativeLabel) nativeLabel.textContent = '已签';
            });
        } catch (e) {
            status.textContent = e instanceof SyntaxError ? '官网返回了验证页面，请手动完成验证后重试' : e.name === 'TimeoutError' ? '签到请求超时，请点击检查 / 重试，脚本会先核对是否已签' : e.message;
        } finally {
            running = false;
            retry.disabled = false;
        }
    }

    void run();
}

if (location.hostname === 'pan.quark.cn') quark();
else if (['hifiti.com', 'www.hifiti.com'].includes(location.hostname)) {
    forum();
    autoSign();
}

})();
