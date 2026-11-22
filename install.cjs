// Local installer: serves the actual production userscript, never the demo.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, 'dist/hifiti-save.user.js');
const script = () => fs.readFileSync(file, 'utf8');
const escape = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function serveInstaller(req, res) {
    if (req.url === '/hifiti-save.user.js') {
        res.writeHead(200, {'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store'});
        return res.end(script());
    }
    if (req.url !== '/') {
        res.writeHead(404);
        return res.end();
    }
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>安装 HiFiTi 一键存网盘</title>
<style>body{font:16px/1.8 system-ui,'Microsoft YaHei';max-width:840px;margin:50px auto;background:#f1f5f2;color:#243b30;padding:0 24px}main{background:white;padding:28px 36px;border:1px solid #d6e3d9;border-radius:16px}h1{font-size:26px}a{color:#14724d}button,.install{display:inline-block;font:inherit;background:#14724d;color:white;border:0;border-radius:8px;padding:10px 18px;cursor:pointer;text-decoration:none;margin:4px 8px 4px 0}textarea{width:100%;height:230px;font:12px/1.5 monospace;border:1px solid #ccd9d0;border-radius:8px}#status{color:#14724d}</style>
<main><h1>HiFiTi 一键存网盘</h1><p>这是本机刚生成的正式脚本安装页，不是模拟演示。</p><ol>
<li>在 Edge 中安装 <a href="https://www.tampermonkey.net/" target="_blank" rel="noopener">Tampermonkey（篡改猴）</a>。已有管理器可跳过。</li>
<li>点击下方「安装脚本」。若未出现脚本安装窗口，用「复制脚本代码」，在篡改猴中添加新脚本、全选替换、保存。</li>
<li>确认篡改猴允许执行用户脚本，然后刷新 <a href="https://hifiti.com/thread-7702.htm" target="_blank" rel="noopener">示例歌曲帖子</a>，检查右下角「HiFiTi · 存网盘」。</li>
<li>在同一 Edge 配置中登录 <a href="https://pan.quark.cn/" target="_blank" rel="noopener">夸克网页版</a>。</li></ol>
<a class="install" href="/hifiti-save.user.js">安装脚本</a><button id="copy">复制脚本代码</button><p id="status" role="status"></p>
<details><summary>查看完整源码（若复制按钮失败，可全选这里）</summary><textarea id="source" readonly spellcheck="false">${escape(script())}</textarea></details>
<p>真实测试将发表「感谢分享。」，首次回复隐藏帖预计扣 1 金币；保存至夸克的 HiFiTi音乐 文件夹。不会下载到电脑。</p></main>
<script>document.querySelector('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(document.querySelector('#source').value);document.querySelector('#status').textContent='已复制，请在篡改猴的新脚本编辑器中全选替换并保存。'}catch{document.querySelector('details').open=true;document.querySelector('#source').select();document.querySelector('#status').textContent='请按 Ctrl+C 复制已选中的代码。'}};</script></html>`);
}

http.createServer(serveInstaller).listen(8928, '127.0.0.1', () => console.log('Installer ready: http://127.0.0.1:8928/'));
