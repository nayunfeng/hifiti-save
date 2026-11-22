// Synthetic local demo only. Never contacts HiFiTi or a real cloud drive.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const script = () => fs.readFileSync(path.join(__dirname, 'dist/hifiti-save.user.js'), 'utf8')
    .replace("location.hostname === 'pan.quark.cn'", "location.pathname.startsWith('/s/')")
    .replace("['hifiti.com', 'www.hifiti.com'].includes(location.hostname)", "!location.pathname.startsWith('/s/')");

function markup(unlocked) {
    return `<h5>下载</h5><p><a href="https://pan.baidu.com/s/demo-baidu">百度分享</a></p><h5>提取码</h5>${unlocked ? '<div class="alert-success">ab12</div>' : '<div class="alert-warning"><a class="post_reply">回复</a>后查看</div>'}<h5>备份</h5>${unlocked ? '<p><a href="https://pan.quark.cn/s/demo-quark">夸克分享</a> 提取码：cd34</p>' : '<div class="alert-warning"><a class="post_reply">回复</a>后查看</div>'}`;
}

const mocks = `
window.GM_getValue=(key,other)=>{try{return JSON.parse(localStorage.getItem(key))??other}catch{return other}};
window.GM_setValue=(key,value)=>localStorage.setItem(key,JSON.stringify(value));
window.GM_deleteValue=key=>localStorage.removeItem(key);
let listenerId=0;
window.GM_addValueChangeListener=(key,fn)=>{addEventListener('storage',e=>{if(e.key===key)fn(key,null,JSON.parse(e.newValue),true)});return ++listenerId;};
window.GM_openInTab=url=>{
  const tab=window.open(url.includes('pan.quark.cn/s/')?url.replace('https://pan.quark.cn',''):url,'_blank');
  return {close:()=>tab?.close(),get closed(){return !tab||tab.closed;}};
};
let pollCount=0;
window.GM_xmlhttpRequest=opts=>{
  const u=new URL(String(opts.url)), p=u.pathname.replace('/1/clouddrive','');
  let data={};
  if(p==='/share/sharepage/token')data={stoken:'demo'};
  else if(p==='/share/sharepage/detail')data={list:[{fid:'f1',file_name:'示例歌曲.flac',size:123,dir:false,share_fid_token:'demo'},{fid:'f2',file_name:'示例歌曲.mp3',size:45,dir:false,share_fid_token:'demo'}],metadata:{_total:2}};
  else if(p==='/file/sort')data={list:[],metadata:{_total:0}};
  else if(p==='/file')data={fid:JSON.parse(String(opts.data)).pdir_fid==='0'?'demo-base':'demo-dest'};
  else if(p==='/share/sharepage/save')data={task_id:'demo-task'};
  else if(p==='/task')data={status:++pollCount>1?2:1};
  const responseText=JSON.stringify({status:200,code:0,data});
  const timer=setTimeout(()=>opts.onload?.({status:200,statusText:'OK',readyState:4,responseHeaders:'Content-Type: application/json',responseText,response:responseText,responseXML:null,finalUrl:u.href,context:opts.context}),100);
  return {abort:()=>clearTimeout(timer)};
};
window.fetch=async(url)=>String(url).includes('/my.htm')?({ok:true,url:new URL('/my.htm',location.origin).href,text:async()=>'<header><a href="my.htm">演示账号</a></header><span class="text-muted">金币：</span><em>1150</em>'}):String(url).includes('/sg_sign.htm')?({ok:true,url:new URL('/sg_sign.htm',location.origin).href,text:async()=>'<header><a href="my.htm">演示账号</a></header><span id="sg_sign"><div id="sign">已签</div></span>'}):({ok:true,url:location.href,text:async()=>'<div id="thread-content">'+(localStorage.getItem('demo-unlocked')||new URLSearchParams(location.search).has('unlocked')?${JSON.stringify(markup(true))}:${JSON.stringify(markup(false))})+'</div>'});
document.querySelector('#quick_reply_form')?.addEventListener('submit',e=>{e.preventDefault();localStorage.setItem('demo-unlocked','1');document.querySelector('#thread-content').innerHTML=${JSON.stringify(markup(true))};document.querySelector('#demo-note').textContent='模拟评论已提交 1 次（没有访问真实网站）';});
`;

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function servePreview(req, res) {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/script.js') {
        res.writeHead(200, {'Content-Type': 'application/javascript; charset=utf-8'});
        return res.end(script());
    }
    if (u.pathname === '/hifiti-save.user.js') {
        res.writeHead(200, {'Content-Type': 'application/javascript; charset=utf-8'});
        return res.end(fs.readFileSync(path.join(__dirname, 'dist/hifiti-save.user.js')));
    }
    const quark = u.pathname.startsWith('/s/');
    const home = u.pathname === '/home';
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HiFiTi 存网盘 · 本地模拟演示</title><style>body{margin:0;background:#e7ebf0;color:#212529;font:14px/1.5 "Helvetica Neue",Helvetica,"Microsoft Yahei",sans-serif}nav{background:#343a40;color:#ced4da;padding:15px 8%}main{max-width:900px;margin:20px 8%;padding:24px;background:white;border:1px solid #00000020;border-radius:3px;box-shadow:0 1px 3px #1a1a1a1a}.demo{color:#95621d;background:#fff5db;padding:10px 16px;border-radius:8px}h4{font-size:26px;margin:18px 0}.alert-warning{background:#fff6d5;padding:14px}a{color:#5f8ece}textarea{width:90%;height:70px}button{padding:8px}</style><nav>HiFiTi · 一键存网盘 / 开发预览</nav><header style="display:none"><a href="my.htm">演示账号</a></header><main><div class="demo">本地模拟演示 · 不会发送真实评论、扣金币或保存文件</div><h4>${quark ? '夸克分享 · 示例歌曲' : '示例歌手《示例歌曲》[FLAC/MP3-320K]'}</h4><p>${quark ? '分享内包含 FLAC 和 MP3 两种格式。' : '示例歌词与歌曲介绍。右下角是脚本新增的保存面板。'}</p>${quark || home ? '' : `<div id="thread-content">${markup(u.searchParams.has('unlocked'))}</div><form id="quick_reply_form" action="post-create-42-1.htm" method="post"><textarea id="message" name="message"></textarea><button id="submit" type="submit">回帖</button></form>`}<p id="demo-note">当前为独立模拟环境。</p></main><script>${mocks}</script><script src="/script.js"></script></html>`);
}

const server = http.createServer(servePreview);
const previewPort = Number(process.env.HFS_PREVIEW_PORT || 8927);
server.listen(previewPort, '127.0.0.1', () => console.log('Local synthetic demo: http://127.0.0.1:' + previewPort + '/thread-42.htm'));
