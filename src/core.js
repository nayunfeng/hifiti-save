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
