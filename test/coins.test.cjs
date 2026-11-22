const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const app = fs.readFileSync(require('node:path').join(__dirname, '../src/app.js'), 'utf8');
const header = name => `<header><a href="my.htm">${name}</a></header>`;
const settle = () => new Promise(r => setTimeout(r, 20));

function setup({account = 'tester', html = '<span class="text-muted">金币：</span><em>1,150</em>', logged = true} = {}) {
    const dom = new JSDOM(logged ? header('tester') : '<header>登录</header>', {
        url: 'https://hifiti.com/',
        runScripts: 'outside-only'
    });
    const w = dom.window;
    let reads = 0;
    w.GM_getValue = (k, d) => k === 'hfs:v1:autoSign' ? false : d;
    w.GM_setValue = () => {
    };
    w.fetch = async (url, opts) => {
        reads++;
        assert.equal(new URL(url).pathname, '/my.htm');
        assert.equal(opts.credentials, 'same-origin');
        assert.equal(opts.method, undefined);
        return {ok: true, url, text: async () => header(account) + html}
    };
    w.eval(app);
    return {dom, w, reads: () => reads, badge: () => w.document.querySelector('.hfs-coins')};
}

test('余额读取支持千分位，点击重新读取', async () => {
    const s = setup();
    await settle();
    assert.equal(s.badge().textContent, '金币 1150');
    assert.equal(s.reads(), 1);
    s.badge().click();
    await settle();
    assert.equal(s.reads(), 2);
    s.dom.window.close();
});
test('字段缺失或账号不匹配不能误报余额，零余额可正常显示', async () => {
    for (const args of [{html: '<span>金币：</span><em>0</em>'}, {account: 'other'}]) {
        const s = setup(args);
        await settle();
        assert.equal(s.badge().textContent, '金币 —');
        s.dom.window.close();
    }
    const s = setup({html: '<span class="text-muted">金币：</span><em>0</em>'});
    await settle();
    assert.equal(s.badge().textContent, '金币 0');
    s.dom.window.close();
});
test('未登录不请求个人中心余额', async () => {
    const s = setup({logged: false});
    await settle();
    assert.equal(s.reads(), 0);
    assert.equal(s.badge().textContent, '金币 —');
    s.dom.window.close();
});
