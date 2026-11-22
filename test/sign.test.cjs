const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const app = fs.readFileSync(require('node:path').join(__dirname, '../src/app.js'), 'utf8');
const prefix = 'hfs:v1:';
const header = name => `<header><a href="my.htm">${name}</a></header>`;
// Match the site's legacy inline script exactly; signState reads its var declaration.
// noinspection ES6ConvertVarToLetConst
const page = (signed, name = 'tester') => `${header(name)}<span id="sg_sign"><div id="sign">签到</div></span><script>var sg_sign = $('#sg_sign'); var s1 = '${signed ? '已签' : '签到'}';</script>`;

function setup({
                   signed = false,
                   logged = true,
                   enabled = true,
                   pending = false,
                   confirm = true,
                   fail = false,
                   account = 'tester',
                   form = ''
               } = {}) {
    const dom = new JSDOM(logged ? header('tester') : '<header><a href="https://hifiti.com/user-login.htm">登录</a></header>', {
        url: 'https://hifiti.com/',
        runScripts: 'outside-only'
    });
    /** Mixed userscript storage: preferences and sign records share the same key space.
     * @type {Map<string, *>}
     */
    const store = new Map([[prefix + 'autoSign', enabled]]);
    const w = dom.window, calls = [];
    const day = new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
    const key = prefix + 'sign:tester:' + day;
    if (pending) store.set(key, {done: false, message: '上次结果待核对'});
    w.GM_getValue = (k, d) => store.has(k) ? store.get(k) : d;
    w.GM_setValue = (k, v) => store.set(k, structuredClone(v));
    Object.defineProperty(w.navigator, 'locks', {value: {request: async (_n, _o, fn) => fn({})}});
    let submitted = false;
    w.fetch = async (url, options) => {
        if (new URL(url).pathname === '/my.htm') return {
            ok: true,
            url,
            text: async () => header('tester') + '<span class="text-muted">金币：</span><em>42</em>'
        };
        calls.push({url, options});
        if (options.method === 'POST') {
            assert.equal(store.get(key).done, false, 'POST前必须记录尝试');
            submitted = true;
            return {ok: true, url, json: async () => ({code: fail ? 1 : 0, message: fail ? '需要验证' : '签到成功'})};
        }
        return {ok: true, url, text: async () => page(signed || (submitted && confirm), account) + form};
    };
    w.eval(app);
    return {dom, w, store, calls, key, status: () => w.document.querySelector('#hfs-sign [role=status]').textContent};
}

const settle = () => new Promise(r => setTimeout(r, 30));
test('每日首次访问签到一次，持久化提交状态并GET确认成功', async () => {
    const s = setup();
    await settle();
    assert.equal(s.calls.filter(c => c.options.method === 'POST').length, 1);
    assert.equal(s.calls.length, 3);
    assert.equal(s.store.get(s.key).done, true);
    assert.match(s.status(), /今日已签到/);
    s.dom.window.close();
});
test('识别服务端内联已签状态，不因占位文本重复POST', async () => {
    const s = setup({signed: true});
    await settle();
    assert.equal(s.calls.length, 1);
    assert.equal(s.store.get(s.key).done, true);
    s.dom.window.close();
});

test('签到表单保留隐藏字段、重复字段和特殊字符', async () => {
    const s = setup({form: '<form id="sg_sign"><input name="token" value="a+b &amp; c"><input name="tag" value="first"><input name="tag" value="second"></form>'});
    await settle();
    const post = s.calls.find(c => c.options.method === 'POST');
    const data = new URLSearchParams(post.options.body);
    assert.equal(data.get('token'), 'a+b & c');
    assert.deepEqual(data.getAll('tag'), ['first', 'second']);
    assert.equal(s.store.get(s.key).done, true);
    s.dom.window.close();
});
test('未登录或关闭自动签到时不发请求', async () => {
    for (const options of [{logged: false}, {enabled: false}]) {
        const s = setup(options);
        await settle();
        assert.equal(s.calls.length, 0);
        s.dom.window.close();
    }
});
test('之前尝试结果不明确时不自动重发，手动检查发现已签只GET', async () => {
    const s = setup({pending: true, signed: true});
    await settle();
    assert.equal(s.calls.length, 0);
    s.w.document.querySelector('#hfs-sign button').click();
    await settle();
    assert.equal(s.calls.length, 1);
    assert.equal(s.store.get(s.key).done, true);
    s.dom.window.close();
});
test('POST成功但官网未确认时不能标记已签', async () => {
    const s = setup({confirm: false});
    await settle();
    assert.equal(s.store.get(s.key).done, false);
    assert.match(s.status(), /尚未确认/);
    s.dom.window.close();
});
test('验证失败暂停，账号变化时禁止POST', async () => {
    const s = setup({fail: true});
    await settle();
    assert.equal(s.store.get(s.key).done, false);
    assert.match(s.status(), /未完成/);
    s.dom.window.close();
    const t = setup({account: 'other'});
    await settle();
    assert.equal(t.calls.length, 1);
    assert.match(t.status(), /登录状态发生变化/);
    t.dom.window.close();
});
test('当天完成记录直接显示，无额外网络请求', async () => {
    const s = setup({pending: true});
    await settle();
    s.store.set(s.key, {done: true});
    s.w.document.querySelector('#hfs-sign button').click();
    await settle();
    assert.equal(s.calls.length, 0);
    assert.match(s.status(), /今日已签到/);
    s.dom.window.close();
});
