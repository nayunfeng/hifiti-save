const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const core = fs.readFileSync(path.join(__dirname, '../src/core.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
const prefix = 'hfs:v1:';
const locked = '<div id="thread-content"><h5>下载</h5><a href="https://pan.baidu.com/s/b">百度</a><h5>提取码</h5><div class="alert-warning"><a class="post_reply">回复</a>后查看</div></div>';
const unlocked = '<div id="thread-content"><h5>下载</h5><a href="https://pan.baidu.com/s/b">百度</a><p>提取码：abcd</p><h5>备份</h5><a href="https://pan.quark.cn/s/q">夸克</a><p>提取码：1234</p></div>';

function setup({pending, job, draft = '', reload = false} = {}) {
    const dom = new JSDOM(`<h4>测试歌曲</h4>${locked}<form id="quick_reply_form" action="post-create-42-1.htm"><textarea id="message">${draft}</textarea><button type="submit" id="submit">回帖</button></form>`, {
        url: 'https://hifiti.com/thread-42.htm',
        runScripts: 'outside-only'
    });
    const w = dom.window, store = new Map(), opened = [];
    let posts = 0, gets = 0;
    if (pending) store.set(prefix + 'post:42', pending);
    if (job) store.set(prefix + 'job:' + job.id, job);
    w.GM_getValue = (k, d) => store.has(k) ? structuredClone(store.get(k)) : d;
    w.GM_setValue = (k, v) => store.set(k, structuredClone(v));
    w.GM_deleteValue = k => store.delete(k);
    w.GM_addValueChangeListener = () => {
    };
    w.GM_openInTab = u => opened.push(u);
    Object.defineProperty(w.navigator, 'locks', {value: {request: async (_name, _options, fn) => fn({name: _name})}});
    w.fetch = async () => {
        gets++;
        return {ok: true, url: w.location.href, text: async () => posts || reload ? unlocked : locked}
    };
    w.setTimeout = fn => setTimeout(fn, 0);
    w.document.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        posts++;
    });
    w.eval(core + '\n' + app);
    return {w, store, opened, dom, counts: () => ({posts, gets})};
}

const settle = () => new Promise(r => setTimeout(r, 70));
test('旧版尚未启动的任务重新打开同一编号，不重复评论或新建任务', async () => {
    const id = '12345678-1234-1234-1234-123456789abc';
    const job = {
        version: 1,
        id,
        provider: 'quark',
        threadId: '42',
        title: '测试歌曲',
        folder: '音乐',
        shareId: 'q',
        code: '1234',
        created: Date.now(),
        phase: 'ready'
    };
    const s = setup({pending: {phase: 'opened', jobId: id}, job});
    s.w.document.querySelector('button.primary').click();
    await settle();
    assert.equal(s.counts().posts, 0);
    assert.equal(s.counts().gets, 0);
    assert.deepEqual(s.opened, [`https://pan.quark.cn/s/q?pwd=1234&hfs_job=${id}`]);
    assert.equal(s.store.get(prefix + 'post:42').jobId, id);
    s.dom.window.close();
});
test('一键只评论一次；解锁后打开带关联任务和提取码的夸克分享', async () => {
    const s = setup();
    s.w.document.querySelector('button.primary').click();
    s.w.document.querySelector('button.primary').click();
    await settle();
    assert.equal(s.counts().posts, 1);
    assert.equal(s.opened.length, 1);
    assert.match(s.opened[0], /^https:\/\/pan.quark.cn\/s\/q\?pwd=1234&hfs_job=/);
    const pending = s.store.get(prefix + 'post:42');
    assert.equal(pending.phase, 'opened');
    const job = s.store.get(prefix + 'job:' + pending.jobId);
    assert.equal(job.code, '1234');
    assert.equal(job.folder, 'HiFiTi音乐');
    assert.equal(job.layout, 'direct');
    s.dom.window.close();
});
test('页面刷新恢复只读取，未解锁也不重复发表评论', async () => {
    const s = setup({pending: {phase: 'reply-submitted', created: Date.now()}});
    await settle();
    assert.equal(s.counts().posts, 0);
    assert.equal(s.opened.length, 0);
    assert.match(s.w.document.querySelector('.hfs-status').textContent, /不会自动再次评论/);
    s.dom.window.close();
});
test('刷新恢复读到解锁资源后继续，不再次评论', async () => {
    const s = setup({pending: {phase: 'reply-submitted', created: Date.now()}, reload: true});
    await settle();
    assert.equal(s.counts().posts, 0);
    assert.equal(s.opened.length, 1);
    s.dom.window.close();
});
test('不覆盖用户回帖草稿', async () => {
    const s = setup({draft: '还没写完'});
    s.w.document.querySelector('button.primary').click();
    await settle();
    assert.equal(s.counts().posts, 0);
    assert.equal(s.w.document.querySelector('#message').value, '还没写完');
    assert.match(s.w.document.querySelector('.hfs-status').textContent, /草稿/);
    s.dom.window.close();
});
test('篡改的回帖目的地址不能提交', async () => {
    const s = setup();
    s.w.document.querySelector('form').action = 'https://evil.invalid/post-create-42-1.htm';
    s.w.document.querySelector('button.primary').click();
    await settle();
    assert.equal(s.counts().posts, 0);
    assert.match(s.w.document.querySelector('.hfs-status').textContent, /表单地址/);
    s.dom.window.close();
});
test('夸克改写 hash 后仍可从 query 找到任务并显示面板', () => {
    const id = '12345678-1234-1234-1234-123456789abc';
    const dom = new JSDOM('<main>夸克分享</main>', {
        url: `https://pan.quark.cn/s/q?pwd=1234&hfs_job=${id}#/list/share`,
        runScripts: 'outside-only'
    });
    const w = dom.window;
    const job = {
        version: 1,
        id,
        provider: 'quark',
        threadId: '42',
        title: '测试歌曲',
        folder: '音乐',
        shareId: 'q',
        code: '1234',
        created: Date.now(),
        phase: 'done',
        message: '已保存到夸克'
    };
    w.GM_getValue = (key, other) => key === prefix + 'job:' + id ? job : other;
    w.GM_setValue = () => {
    };
    w.GM_openInTab = () => {
    };
    w.eval(core + '\n' + app);
    assert.match(w.document.querySelector('#hfs-panel').textContent, /已保存到夸克/);
    dom.window.close();
});
