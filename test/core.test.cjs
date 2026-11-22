const {test} = require('node:test');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const H = require('../src/core.js');
const extract = html => H.extract(new JSDOM(`<div id="thread-content">${html}</div>`).window.document.querySelector('#thread-content'));
const link = (id, provider = 'quark') => `<a href="https://pan.${provider === 'quark' ? 'quark.cn' : 'baidu.com'}/s/${id}">资源</a>`;
const ok = data => ({status: 200, code: 0, data});

function job() {
    return {
        version: 1,
        id: '12345678-1234-1234-1234-123456789abc',
        provider: 'quark',
        threadId: '42',
        title: '歌手《歌曲》',
        folder: '音乐',
        shareId: 'abc',
        code: 'a1b2',
        created: Date.now(),
        phase: 'ready',
        layout: 'direct'
    };
}

test('只接收确切网盘域名和分享路径', () => {
    // Deliberately insecure input: verify HTTP shares are rejected.
    // noinspection HttpUrlsUsage
    for (const u of ['https://pan.quark.cn.evil.com/s/a', 'javascript:alert(1)', 'https://pan.quark.cn@evil.com/s/a', 'http://pan.quark.cn/s/a', 'https://pan.quark.cn/disk', 'https://x:secret@pan.quark.cn/s/a']) assert.equal(H.shareURL(u), null);
    assert.equal(H.shareURL('https://pan.quark.cn/s/abc?pwd=1234').code, '1234');
});
test('百度提取码与备用夸克提取码分别配对', () => {
    const r = extract(`<h5>下载</h5><p>${link('b', 'baidu')}</p><h5>提取码</h5><div class="alert-success">a1b2</div><h5>备份</h5><div>${link('q')} 提取码：c3d4</div>`);
    assert.deepEqual(r.map(x => [x.id, x.code]), [['b', 'a1b2'], ['q', 'c3d4']]);
});
test('纯文本链接、中文冒号和嵌套标签', () => {
    const r = extract('<p>https://pan.quark.cn/s/plain</p><p><strong>提取码：</strong><span>AB12</span></p>');
    assert.equal(r[0].id, 'plain');
    assert.equal(r[0].code, 'AB12');
});
test('多个资源后无归属的提取码不猜配；带网盘标签可配对', () => {
    assert.deepEqual(extract(`${link('q')}${link('b', 'baidu')}<p>提取码：1234</p>`).map(x => x.code), ['', '']);
    assert.deepEqual(extract(`${link('q')}${link('b', 'baidu')}<p>夸克提取码：1234</p><p>百度提取码：5678</p>`).map(x => x.code), ['1234', '5678']);
});
test('不读取隐藏节点、脚本、CSS 隐藏和评论区链接', () => {
    const dom = new JSDOM(`<style>.secret{display:none}</style><div id="thread-content">${link('yes')}<div hidden>${link('no1')}</div><div style="display:none">${link('no2')}</div><div class="secret">${link('no3')}</div><script>${link('no4')}</script></div><div>${link('comment')}</div>`);
    assert.deepEqual(H.extract(dom.window.document.querySelector('#thread-content')).map(x => x.id), ['yes']);
});
test('资源去重且保留已有 URL 提取码', () => {
    const r = extract('<a href="https://pan.quark.cn/s/q?pwd=1234">链接</a>' + link('q') + '<p>提取码：abcd</p>');
    assert.equal(r.length, 1);
    assert.equal(r[0].code, '1234');
});
test('任务校验拒绝过期、错误分享及目录穿越', () => {
    const j = job();
    assert.equal(H.validJob(j, 'abc'), true);
    assert.equal(H.validJob(j, 'wrong'), false);
    assert.equal(H.validJob({...j, created: Date.now() - 31 * 60000}, 'abc'), false);
    assert.equal(H.validJob({...j, folder: '../bad'}, 'abc'), false);
    // This is an invalid extraction code, not an HTML document.
    // noinspection HtmlRequiredLangAttribute
    assert.equal(H.validJob({...j, code: '<html>'}, 'abc'), false);
    assert.equal(H.safeName('歌手/歌曲:*?'), '歌手_歌曲___');
});
test('目录分页不能因为服务端缩短每页而漏项', async () => {
    let pages = [];
    const api = new H.Quark(async (_m, u) => {
        const p = Number(new URL(u).searchParams.get('_page'));
        pages.push(p);
        return ok({list: p === 1 ? [{fid: '1'}] : p === 2 ? [{fid: '2'}] : []});
    }, async () => {
    });
    assert.equal((await api.mine('0')).length, 2);
    assert.deepEqual(pages, [1, 2, 3]);
});
test('重复分页及截断分页停止', async () => {
    const a = new H.Quark(async () => ok({list: [{fid: '1'}], metadata: {_total: 2}}), async () => {
    });
    await assert.rejects(a.mine('0'), /重复/);
    let n = 0;
    const b = new H.Quark(async () => ok({list: n++ ? [] : [{fid: '1'}], metadata: {_total: 2}}), async () => {
    });
    await assert.rejects(b.mine('0'), /未读完/);
});

function harness(options = {}) {
    const calls = [];
    let taskPoll = 0;
    const entries = [];
    const file = {fid: 'f1', file_name: '歌曲.flac', file: true, dir: false, size: 123, share_fid_token: 'test-only'};
    const api = new H.Quark(async (m, u, b) => {
        const url = new URL(u), path = url.pathname.replace('/1/clouddrive', '');
        calls.push({m, path, b});
        if (path === '/share/sharepage/token') return options.authFail ? {
            status: 401,
            code: 1,
            message: '未登录'
        } : ok({stoken: 'synthetic'});
        if (path === '/share/sharepage/detail') return ok({list: [file], metadata: {_total: 1}});
        if (path === '/file/sort') {
            const parent = url.searchParams.get('pdir_fid');
            const list = parent === '0' ? [{fid: 'base', file_name: '音乐', dir: true}] : options.existing ? [{
                ...file,
                share_fid_token: undefined,
                fid: 'existing'
            }] : entries;
            return ok({list, metadata: {_total: list.length}});
        }
        if (path === '/share/sharepage/save') {
            if (options.timeout) throw new Error('timeout');
            if (options.noTask) return ok({});
            return ok({task_id: 'task1'});
        }
        if (path === '/task') {
            taskPoll++;
            return ok({status: options.taskFail ? 3 : taskPoll > 1 ? 2 : 1});
        }
        throw new Error('Unexpected ' + path);
    }, async () => {
    });
    return {api, calls};
}

test('转存必须持久化 saving 后再 POST，处理中不算成功', async () => {
    const {api, calls} = harness();
    const j = job(), states = [];
    const r = await api.save(j, (_msg, state) => {
        if (state) states.push({...state});
    });
    assert.deepEqual(r, {saved: 1, skipped: 0});
    assert.equal(calls.filter(c => c.path === '/share/sharepage/save').length, 1);
    assert.equal(calls.filter(c => c.path === '/task').length, 2);
    assert.equal(states[0].phase, 'saving');
    assert.equal(states[1].taskId, 'task1');
    assert.equal(calls.find(c => c.path === '/share/sharepage/save').b.to_pdir_fid, 'base');
    assert.ok(!calls.some(c => c.path === '/file'), '不应新建帖子标题目录');
});
test('未知保存响应不重试 POST', async () => {
    const {api, calls} = harness({timeout: true});
    const j = job();
    await assert.rejects(api.save(j, () => {
    }), /timeout/);
    assert.equal(j.phase, 'saving');
    await assert.rejects(api.save(j, () => {
    }), /不明确/);
    assert.equal(calls.filter(c => c.path === '/share/sharepage/save').length, 1);
});
test('中断任务只轮询，不重新授权或转存', async () => {
    const {api, calls} = harness();
    const j = {...job(), phase: 'uncertain', taskId: 'previous', count: 1};
    await api.save(j, () => {
    });
    assert.ok(calls.every(c => c.path === '/task'));
});
test('失败任务和无任务编号且无落盘证据都不能报成功', async () => {
    for (const options of [{taskFail: true}, {noTask: true}]) {
        const {api} = harness(options);
        await assert.rejects(api.save(job(), () => {
        }));
    }
});
test('未登录时不创建目录或发出保存请求', async () => {
    const {api, calls} = harness({authFail: true});
    await assert.rejects(api.save(job(), () => {
    }), /未登录/);
    assert.equal(calls.length, 1);
});
test('同名同大小文件跳过，避免重复转存', async () => {
    const {api, calls} = harness({existing: true});
    assert.deepEqual(await api.save(job(), () => {
    }), {saved: 0, skipped: 1});
    assert.ok(!calls.some(c => c.path === '/share/sharepage/save'));
});

function directoryHarness(change = {}) {
    const calls = [];
    const src = {
        '0': [{fid: 'sf', file_name: '红装', dir: true, share_fid_token: 'test-only'}],
        sf: [{fid: 'sn', file_name: '无损', dir: true}, {fid: 'sm', file_name: '红装.mp3', dir: false, size: 9}],
        sn: [{fid: 'sa', file_name: '红装.flac', dir: false, size: 150}]
    };
    const dst = {
        '0': [{fid: 'base', file_name: '音乐', dir: true}],
        base: [{fid: 'df', file_name: '红装', dir: true}],
        df: [{fid: 'dn', file_name: '无损', dir: true}, {fid: 'dm', file_name: '红装.mp3', dir: false, size: 9}],
        dn: [{fid: 'da', file_name: '红装.flac', dir: false, size: 150}]
    };
    if (change.size) dst.dn[0].size = 151;
    if (change.missing) dst.dn = [];
    if (change.duplicate) src.sf[1] = {...src.sf[0], fid: 'duplicate'};
    const api = new H.Quark(async (m, u) => {
        const url = new URL(u), path = url.pathname.replace('/1/clouddrive', '');
        calls.push({m, path});
        if (path === '/share/sharepage/token') return ok({stoken: 'test-only'});
        const parent = url.searchParams.get('pdir_fid');
        const list = path === '/share/sharepage/detail' ? src[parent] : path === '/file/sort' ? dst[parent] : null;
        assert.ok(list, '不应写入或重复转存');
        return ok({list, metadata: {_total: list.length}});
    }, async () => {
    });
    return {api, calls};
}

test('同名文件夹逐层匹配名称类型大小后跳过，不重复保存', async () => {
    const {api, calls} = directoryHarness();
    const j = job();
    assert.deepEqual(await api.save(j, () => {
    }), {saved: 0, skipped: 1});
    assert.equal(j.destination, 'base');
    assert.ok(calls.filter(c => c.m === 'POST').every(c => c.path === '/share/sharepage/token'));
});
test('同名文件夹内缺文件或大小不同会解释差异且不写入', async () => {
    for (const change of [{size: true}, {missing: true}]) {
        const {api} = directoryHarness(change);
        await assert.rejects(api.save(job(), () => {
        }), /数量、类型或大小.*未覆盖/);
    }
});
test('分享子目录有重复名称时不能误判相同', async () => {
    const {api} = directoryHarness({duplicate: true});
    await assert.rejects(api.save(job(), () => {
    }), /未覆盖/);
});
