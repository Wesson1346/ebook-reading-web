// 零依赖 E2E 冒烟测试：用系统 Chrome + Node 内置 WebSocket 走 CDP 驱动真实浏览器。
// 用法：node e2e/smoke.mjs <repoDir>   （不依赖任何 npm 包）
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repoDir = path.resolve(process.argv[2] || process.cwd());
const sampleFile = path.join(repoDir, 'samples', 'sample.txt');

const MIME = {
  html: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json',
};

// ---------- 静态服务器 ----------
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(repoDir, p);
    if (!file.startsWith(repoDir)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(file).slice(1).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv)));
}

// ---------- 找浏览器 ----------
function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

// ---------- 极简 CDP 客户端 ----------
function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      p.resolve(msg.result || { error: msg.error });
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value || a.description || '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push('Exception: ' + (d.exception?.description || d.text));
    }
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const n = ++id;
    pending.set(n, { resolve });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evalRaw = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return r.result || {};
  };
  const evalv = async (expression) => (await evalRaw(expression)).value;
  return { ws, ready, send, evalRaw, evalv, consoleErrors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 9000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    try { last = await fn(); if (last) return last; } catch {}
    await sleep(150);
  }
  throw new Error('waitFor 超时，最后一次结果: ' + JSON.stringify(last));
}

function parseInfo(t) {
  const parts = (t || '').split('/').map((s) => parseInt(s.trim(), 10));
  return { cur: parts[0], total: parts[1] };
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log((ok ? '  [PASS] ' : '  [FAIL] ') + name + (detail ? ' — ' + detail : ''));
}

// ---------- 主流程 ----------
let c = null;
try {
  const server = await serve();
  const port = server.address().port;
  const chromePath = findChrome();
  if (!chromePath) throw new Error('未找到 Chrome/Edge，请设置 CHROME_PATH 后重试');

  const dbgPort = 9300 + Math.floor(Math.random() * 2000);
  const userDataDir = path.join(repoDir, 'e2e', '.chrome-profile');
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${dbgPort}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
  ], { stdio: 'ignore' });

  const base = `http://127.0.0.1:${port}/index.html`;

  // 等 devtools 就绪
  let page;
  await waitFor(async () => {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${dbgPort}/json`)).json();
      page = targets.find((t) => t.type === 'page');
      return !!page;
    } catch { return false; }
  }, 15000);

  c = cdp(page.webSocketDebuggerUrl);
  await c.ready;
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('DOM.enable');

  const nav = (url) => c.send('Page.navigate', { url });
  await nav(base);
  await waitFor(async () => await c.evalv("document.readyState==='complete'"), 15000);
  await waitFor(async () => await c.evalv("!!document.getElementById('pageInfo')"), 15000);

  // 1) 空态
  const hasEmpty = await c.evalv("!!document.getElementById('emptyState')");
  check('页面加载显示空态', hasEmpty === true);

  // 2) 导入示例书（真实 file input）
  const docRes = await c.send('DOM.getDocument', { depth: -1 });
  const qRes = await c.send('DOM.querySelector', { nodeId: docRes.root.nodeId, selector: '#fileInput' });
  await c.send('DOM.setFileInputFiles', { files: [sampleFile], nodeId: qRes.nodeId });
  await waitFor(async () => {
    const t = await c.evalv("document.getElementById('pageInfo').textContent");
    return t && t.trim() !== '— / —' ? t : null;
  }, 12000);
  const info1 = parseInfo(await c.evalv("document.getElementById('pageInfo').textContent"));
  check('能导入并显示分页信息', info1.total > 1, `第 ${info1.cur}/${info1.total} 页`);

  const chapterCount = await c.evalv("document.querySelectorAll('#tocList li').length");
  check('目录识别到多章', chapterCount >= 5, `${chapterCount} 章`);

  const readerTextLen = await c.evalv("(document.getElementById('reader').innerText||'').trim().length");
  check('阅读区渲染出正文', readerTextLen > 0, `正文 ${readerTextLen} 字符`);

  // 3) 下一页
  await c.evalv("document.getElementById('nextBtn').click()");
  await sleep(150);
  const info2 = parseInfo(await c.evalv("document.getElementById('pageInfo').textContent"));
  check('点击下一页页码变化', info2.cur === info1.cur + 1, `${info1.cur}→${info2.cur}`);
  const prevEnabled = await c.evalv("!document.getElementById('prevBtn').disabled");
  check('翻页后上一页按钮可用', prevEnabled === true);

  // 4) 目录跳转：点击第 3 章
  await c.evalv("document.querySelectorAll('#tocList li a')[2].click()");
  await sleep(150);
  const h2all = await c.evalv("Array.from(document.querySelectorAll('#reader .chapter-title')).map(function(e){return e.textContent}).join('|')");
  check('点击目录跳到对应章节（落地页含目标章）', h2all.includes('第三章'), h2all);

  // 5) 主题切换
  const t0 = await c.evalv("document.body.getAttribute('data-theme')");
  await c.evalv("document.getElementById('themeToggle').click()");
  await sleep(100);
  const t1 = await c.evalv("document.body.getAttribute('data-theme')");
  check('主题可切换', t0 !== t1, `${t0}→${t1}`);

  // 6) 字号调节 + 重分页
  const totalBefore = (await c.evalv("document.getElementById('pageInfo').textContent")).split('/')[1].trim();
  await c.evalv("document.getElementById('fontPlus').click()");
  await sleep(200);
  const infoAfter = parseInfo(await c.evalv("document.getElementById('pageInfo').textContent"));
  check('字号变化后页数改变且页码有效', infoAfter.total !== Number(totalBefore) && infoAfter.cur >= 1 && infoAfter.cur <= infoAfter.total,
    `${totalBefore} 页 → ${infoAfter.total} 页，当前 ${infoAfter.cur}`);

  // 7) 刷新后自动恢复（localStorage 缓存 + 进度）
  const keepPage = infoAfter.cur;
  await nav(base);
  await waitFor(async () => {
    const t = await c.evalv("!!document.getElementById('pageInfo') && document.getElementById('pageInfo').textContent");
    return t && t.trim() !== '— / —' ? t : null;
  }, 12000);
  const infoRestored = parseInfo(await c.evalv("document.getElementById('pageInfo').textContent"));
  const tocAfterReload = await c.evalv("document.querySelectorAll('#tocList li').length");
  check('刷新后自动恢复上次进度', infoRestored.cur === keepPage && tocAfterReload >= 5,
    `当前第 ${infoRestored.cur}/${infoRestored.total} 页，目录 ${tocAfterReload} 章`);

  // 8) 无 JS 错误
  check('无控制台 JS 错误', c.consoleErrors.length === 0, c.consoleErrors.join(' | '));

  chrome.kill('SIGKILL');
  server.close();
  c.ws.close();

  const failed = results.filter((r) => !r.ok);
  console.log('\n===== 结果 =====');
  console.log(`${results.length - failed.length}/${results.length} 项通过`);
  process.exit(failed.length ? 1 : 0);
} catch (err) {
  console.log('\n  [ERROR] ' + (err && err.stack ? err.stack : err));
  try {
    if (c && c.evalv) {
      console.log('  [diag] pageInfo = ' + (await c.evalv("(document.getElementById('pageInfo')||{}).textContent")));
      console.log('  [diag] reader(前80字符) = ' + (await c.evalv("(document.getElementById('reader')||{}).innerText||''")).slice(0, 80));
      console.log('  [diag] consoleErrors = ' + JSON.stringify(c.consoleErrors));
    }
  } catch (e) { console.log('  [diag] (无法取诊断) ' + e.message); }
  console.log('\n===== 结果 =====');
  console.log(`${results.filter((r) => r.ok).length}/${results.length} 项通过`);
  process.exit(1);
}
