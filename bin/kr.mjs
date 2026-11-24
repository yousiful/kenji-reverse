#!/usr/bin/env node
// kenji-reverse: reverse engineer any funnel, page or web app from real evidence.
// Zero dependencies. Node 22+ and Google Chrome. MIT, KenjiAI (kenjiai.com).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.KR_PORT || 9333);
const DIR = path.resolve(process.env.KR_DIR || 'evidence');
const STATE = path.join(DIR, '.kr');
const [cmd, ...args] = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? (args.splice(i, 2)[1] ?? true) : undefined; };
const has = (n) => { const i = args.indexOf(`--${n}`); if (i >= 0) { args.splice(i, 1); return true; } return false; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
fs.mkdirSync(STATE, { recursive: true });

// ---------- CDP ----------
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const subs = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    else subs.forEach((f) => f(m));
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error(`Chrome not reachable on ${PORT}. Run: kr start`)); });
  return {
    send: (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, sessionId })); }),
    on: (f) => subs.push(f),
    close: () => ws.close(),
  };
}
const json = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
async function page() {
  const list = await json('/json/list').catch(() => { throw new Error(`Chrome not running on ${PORT}. Run: kr start`); });
  const t = list.find((x) => x.type === 'page' && !x.url.startsWith('devtools'));
  if (!t) throw new Error('No open tab');
  const c = await cdp(t.webSocketDebuggerUrl); c.target = t; return c;
}
async function evaluate(c, expr) {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
  return r.result.value;
}
async function settle(c, ms = 1500) {
  for (let i = 0; i < 40; i++) { if ((await evaluate(c, 'document.readyState').catch(() => '')) === 'complete') break; await sleep(250); }
  await sleep(ms);
}

// ---------- recorder (runs detached after `kr start`) ----------
async function recorder() {
  const v = await json('/json/version'); const c = await cdp(v.webSocketDebuggerUrl);
  const out = fs.createWriteStream(path.join(DIR, 'network.jsonl'), { flags: 'a' });
  const bodies = path.join(DIR, 'bodies'); fs.mkdirSync(bodies, { recursive: true });
  const reqs = new Map(); let n = 0;
  c.on(async (m) => {
    const s = m.sessionId; const p = m.params || {};
    if (m.method === 'Target.attachedToTarget') {
      await c.send('Network.enable', { maxResourceBufferSize: 5e6 }, p.sessionId).catch(() => {});
      await c.send('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => {});
    }
    if (m.method === 'Network.requestWillBeSent') reqs.set(p.requestId, { t: new Date().toISOString(), method: p.request.method, url: p.request.url, type: p.type, post: p.request.postData?.slice(0, 4000) });
    if (m.method === 'Network.responseReceived') { const r = reqs.get(p.requestId); if (r) Object.assign(r, { status: p.response.status, mime: p.response.mimeType, type: p.type }); }
    if (m.method === 'Network.loadingFinished') {
      const r = reqs.get(p.requestId); if (!r) return; reqs.delete(p.requestId);
      if (r.url.startsWith('data:')) return;
      const keep = ['XHR', 'Fetch', 'Document'].includes(r.type) || /json|javascript/.test(r.mime || '') && /gtm|tag|config|api/i.test(r.url);
      if (keep && p.encodedDataLength < 3e6) {
        const b = await c.send('Network.getResponseBody', { requestId: p.requestId }, s).catch(() => null);
        if (b && !b.base64Encoded) { const f = `${String(++n).padStart(4, '0')}${/json/.test(r.mime) ? '.json' : /html/.test(r.mime) ? '.html' : '.txt'}`; fs.writeFileSync(path.join(bodies, f), b.body); r.body = `bodies/${f}`; }
      }
      out.write(JSON.stringify(r) + '\n');
    }
  });
  await c.send('Target.setDiscoverTargets', { discover: true });
  await c.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  c.on(async (m) => { if (m.method === 'Target.targetCreated' && m.params.targetInfo.type === 'page') await c.send('Target.attachToTarget', { targetId: m.params.targetInfo.targetId, flatten: true }).catch(() => {}); });
  for (const t of (await c.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page')) await c.send('Target.attachToTarget', { targetId: t.targetId, flatten: true }).catch(() => {});
  setInterval(() => {}, 1 << 30);
}

// ---------- helpers ----------
const TRACKERS = [
  ['Meta Pixel', /fbq\(\s*['"]init['"]\s*,\s*['"](\d{8,})/g], ['Meta Pixel', /facebook\.com\/tr\/?\?id=(\d{8,})/g], ['Google Tag Manager', /\b(GTM-[A-Z0-9]{4,})/g], ['Google Analytics 4', /\b(G-[A-Z0-9]{6,})/g],
  ['Google Ads', /\b(AW-\d{6,})/g], ['TikTok Pixel', /ttq\.load\(['"]([A-Z0-9]+)/g], ['Hyros', /(hyros\.com)/g], ['Microsoft Clarity', /clarity\.ms\/tag\/(\w+)/g],
  ['Hotjar', /hjid[:=]\s*(\d+)/g], ['Stripe', /(js\.stripe\.com)/g], ['ClickFunnels', /(clickfunnels|cf-assets)/g], ['GoHighLevel', /(leadconnectorhq|msgsndr|highlevel)/g],
  ['Kajabi', /(kajabi)/g], ['Calendly', /(calendly\.com)/g], ['Vimeo', /(player\.vimeo\.com)/g], ['Wistia', /(wistia)/g], ['Segment', /(cdn\.segment\.com)/g],
];
function trackers(text) {
  const found = {};
  for (const [name, re] of TRACKERS) for (const m of text.matchAll(re)) (found[name] ||= new Set()).add(m[1]);
  return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, [...v]]));
}
const PAGE_INFO = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const prices = [...new Set((document.body.innerText.match(/\\$\\s?\\d[\\d,]*(\\.\\d\\d)?/g) || []))];
  return {
    url: location.href, title: document.title,
    headings: [...document.querySelectorAll('h1,h2,h3')].filter(vis).map(h => h.tagName + ': ' + h.innerText.trim().slice(0, 120)).slice(0, 30),
    prices,
    buttons: [...document.querySelectorAll('button,a,[role=button],input[type=submit]')].filter(vis).map(b => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().slice(0, 60)).filter(Boolean).slice(0, 60),
    forms: [...document.querySelectorAll('form')].map(f => ({ action: f.action, method: f.method, fields: [...f.elements].filter(e => e.name || e.id).map(e => (e.type || e.tagName) + ':' + (e.name || e.id)) })),
    links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href).filter(h => h.startsWith('http')))].slice(0, 80),
    scripts: [...document.scripts].map(s => s.src).filter(Boolean),
  };
})()`;

// ---------- commands ----------
const C = {
  async start() {
    const headless = has('headless'); const url = args[0] || 'about:blank';
    try { await json('/json/version'); log(`Chrome already running on ${PORT}`); } catch {
      const exe = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) => fs.existsSync(p));
      if (!exe) throw new Error('Chrome not found. Set CHROME=/path/to/chrome');
      const a = [`--remote-debugging-port=${PORT}`, `--user-data-dir=${path.join(STATE, 'profile')}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,900', url];
      if (headless) a.unshift('--headless=new');
      spawn(exe, a, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      for (let i = 0; i < 40; i++) { try { await json('/json/version'); break; } catch { await sleep(250); } }
    }
    const r = spawn(process.execPath, [process.argv[1], '_record'], { detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, KR_DIR: DIR } });
    r.unref(); fs.writeFileSync(path.join(STATE, 'recorder.pid'), String(r.pid));
    log(`Recording every network call to ${path.join(DIR, 'network.jsonl')}`);
  },
  async _record() { await recorder(); },
  async stop() {
    const pid = Number(fs.readFileSync(path.join(STATE, 'recorder.pid'), 'utf8')); try { process.kill(pid); } catch {}
    try { const v = await json('/json/version'); const c = await cdp(v.webSocketDebuggerUrl); await c.send('Browser.close').catch(() => {}); } catch {}
    log('Stopped Chrome and the recorder.');
  },
  async goto() { const c = await page(); await c.send('Page.enable'); await c.send('Page.navigate', { url: args[0] }); await settle(c, 2000); log(await evaluate(c, 'location.href + "  |  " + document.title')); c.close(); },
  async click() {
    const text = args.join(' '); const c = await page();
    const pt = await evaluate(c, `(() => { const want = ${JSON.stringify(text.toLowerCase())};
      const els = [...document.querySelectorAll('button,a,[role=button],[role=option],[role=gridcell],input[type=submit],label,li,td,div,span')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const t = (e) => (e.innerText || e.value || e.getAttribute('aria-label') || '').trim().toLowerCase();
      const e = els.find(e => t(e) === want) || els.find(e => t(e).startsWith(want)) || els.find(e => t(e).includes(want));
      if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, tag: e.tagName, text: t(e).slice(0, 60) }; })()`);
    if (!pt) { log(`No visible element with text "${text}"`); process.exitCode = 1; return c.close(); }
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await c.send('Input.dispatchMouseEvent', { type, x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await settle(c, 1500); log(`Clicked <${pt.tag}> "${pt.text}" -> ${await evaluate(c, 'location.href')}`); c.close();
  },
  async type() { const [sel, ...t] = args; const c = await page(); await evaluate(c, `document.querySelector(${JSON.stringify(sel)}).focus()`); await c.send('Input.insertText', { text: t.join(' ') }); log(`Typed into ${sel}`); c.close(); },
  async shot() {
    const c = await page(); const d = path.join(DIR, 'shots'); fs.mkdirSync(d, { recursive: true });
    const full = has('full'); const name = args[0] ? (/\.png$/i.test(args[0]) ? args[0] : `${args[0]}.png`) : `${String(fs.readdirSync(d).length + 1).padStart(3, '0')}.png`;
    const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full });
    fs.writeFileSync(path.join(d, name), Buffer.from(r.data, 'base64')); log(path.join(d, name)); c.close();
  },
  async look() {
    const c = await page(); const info = await evaluate(c, PAGE_INFO);
    const html = await evaluate(c, 'document.documentElement.outerHTML'); info.trackers = trackers(html);
    const d = path.join(DIR, 'pages'); fs.mkdirSync(d, { recursive: true });
    const f = path.join(d, `${String(fs.readdirSync(d).length / 2 + 1).padStart(3, '0')}`);
    fs.writeFileSync(f + '.json', JSON.stringify(info, null, 2)); fs.writeFileSync(f + '.html', html);
    log(JSON.stringify({ ...info, links: info.links.length + ' links', scripts: info.scripts.length + ' scripts' }, null, 2)); log(`saved ${f}.json`); c.close();
  },
  async text() { const c = await page(); log((await evaluate(c, 'document.body.innerText')).slice(0, Number(flag('max') || 6000))); c.close(); },
  async eval() { const c = await page(); log(JSON.stringify(await evaluate(c, args.join(' ')), null, 2)); c.close(); },
  async net() {
    const only = flag('grep'); const api = has('api'); const f = path.join(DIR, 'network.jsonl');
    const rows = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const sel = rows.filter((r) => (!api || ['XHR', 'Fetch'].includes(r.type)) && (!only || r.url.includes(only)));
    for (const r of sel.slice(-Number(flag('last') || 80))) log(`${r.status ?? '...'} ${r.method} ${r.type || ''} ${r.url.slice(0, 160)}${r.body ? '  -> ' + r.body : ''}${r.post ? '\n      body: ' + r.post.slice(0, 200) : ''}`);
    log(`\n${sel.length} of ${rows.length} recorded calls`);
  },
  async tags() {
    let html = '';
    if (args[0]?.startsWith('http')) html = await (await fetch(args[0], { headers: { 'user-agent': 'Mozilla/5.0 kenji-reverse' } })).text();
    else { const c = await page(); html = await evaluate(c, 'document.documentElement.outerHTML'); c.close(); }
    const nf = path.join(DIR, 'network.jsonl'); if (fs.existsSync(nf)) html += '\n' + fs.readFileSync(nf, 'utf8');
    const t = trackers(html); log(JSON.stringify(t, null, 2));
    for (const id of t['Google Tag Manager'] || []) {
      const js = await (await fetch(`https://www.googletagmanager.com/gtm.js?id=${id}`)).text();
      const urls = [...new Set(js.match(/https?:\\?\/\\?\/[a-z0-9.\-]+[^"'\s\\]*/gi) || [])].map((u) => u.replace(/\\\//g, '/'));
      const paths = [...new Set(js.match(/"\/[a-z0-9\-_/]{3,60}"/gi) || [])];
      fs.writeFileSync(path.join(DIR, `${id}.js`), js);
      log(`\n${id}: ${js.length} bytes saved to ${id}.js`); log('Pixels inside the container:', JSON.stringify(trackers(js))); log('URLs it references:\n  ' + urls.slice(0, 60).join('\n  ')); log('Page paths it fires on:\n  ' + paths.slice(0, 60).join('\n  '));
    }
  },
  async wayback() {
    const url = args[0]; const get = flag('get');
    if (get) {
      const r = await fetch(`https://web.archive.org/web/${get}id_/${url}`); const body = await r.text();
      const d = path.join(DIR, 'wayback'); fs.mkdirSync(d, { recursive: true });
      const f = path.join(d, `${get}_${url.replace(/[^a-z0-9]+/gi, '_').slice(0, 80)}.html`); fs.writeFileSync(f, body);
      log(`${r.status} saved ${f}`); log(JSON.stringify({ trackers: trackers(body), prices: [...new Set(body.match(/\$\s?\d[\d,]*(\.\d\d)?/g) || [])].slice(0, 20) }, null, 2)); return;
    }
    const host = new URL(url.startsWith('http') ? url : `https://${url}`).host;
    const q = `https://web.archive.org/cdx/search/cdx?url=${host}/*&output=json&fl=timestamp,original,statuscode&collapse=urlkey&filter=statuscode:200&filter=mimetype:text/html&limit=${flag('limit') || 400}`;
    const rows = (await (await fetch(q)).json()).slice(1);
    for (const [ts, orig] of rows) log(`${ts}  ${orig}`);
    log(`\n${rows.length} archived pages. Fetch one: kr wayback <url> --get <timestamp>`);
  },
};

const fn = C[cmd];
if (!fn) {
  log(`kenji-reverse: reverse engineer any funnel, page or web app from real evidence

  kr start [url] [--headless]   open Chrome and record every network call
  kr goto <url>                  navigate the tab
  kr click <visible text>        real mouse click on the element with that text
  kr type <css> <text>           type into a field (never submit payment forms)
  kr look                        headings, prices, buttons, forms, links, trackers
  kr text [--max n]              visible page text
  kr shot [name] [--full]        screenshot into evidence/shots
  kr net [--api] [--grep s]      the calls the page made, with saved bodies
  kr eval <js>                   run JavaScript in the page
  kr tags [url]                  pixels + Tag Manager container decode
  kr wayback <url> [--get ts]    archived pages for dead or changed funnels
  kr stop

Evidence goes to ./evidence (set KR_DIR to change). Built by KenjiAI, kenjiai.com`);
  process.exit(cmd ? 1 : 0);
}
fn().catch((e) => { console.error('Error:', e.message); process.exit(1); });
