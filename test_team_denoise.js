/* team_denoise suite: repeat-collapse (vColBtn / .runcount) + gap detector (vGapBtn / .dlt.gap).
   Stub-based like test_viewer_ui.js, plus functional drives: the collapse render, badge
   expansion (stopPropagation guard) and the real streaming gap scan over a File blob. */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'loglens.html'), 'utf8');
const coreCode = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const uiCode = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];

// ---- DOM stubs (event listeners recorded so handlers can be fired) ----
const els = {};
function el(id){
  if (els[id]) return els[id];
  const e = {
    id, style: { setProperty(){} }, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
    disabled: false, checked: true, title: '', placeholder: '', scrollTop: 0, clientHeight: 300, className: '',
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
                 toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c); } else if(f) this._s.add(c); else this._s.delete(c); },
                 contains(c){ return this._s.has(c); } },
    setAttribute(){}, appendChild(c){ this.children.push(c); },
    _handlers: {},
    addEventListener(t, fn){ (this._handlers[t] = this._handlers[t] || []).push(fn); },
    removeEventListener(){},
    querySelector(sel){ return el(id + '>' + sel); },
    querySelectorAll(){ return [el(id+'>a'), el(id+'>b'), el(id+'>c'), el(id+'>d')]; },
    click(){}, scrollIntoView(){},
  };
  els[id] = e;
  return e;
}
global.document = {
  getElementById: el,
  createElement: tag => el('create:' + tag + ':' + Math.random()),
  head: { appendChild(){} },
  body: (() => { const a = {}; return { setAttribute(n,v){ a[n]=String(v); }, getAttribute(n){ return Object.prototype.hasOwnProperty.call(a,n) ? a[n] : null; }, removeAttribute(n){ delete a[n]; }, dataset: {}, style: { setProperty(){} } }; })(),
};
global.window = global;
global.addEventListener = () => {};
let storeMap = {};
global.localStorage = { getItem: k => (k in storeMap ? storeMap[k] : null), setItem(k,v){ storeMap[k] = String(v); } };
global.alert = m => { throw new Error('alert called: ' + m); };
let asyncErr = null;
process.on('unhandledRejection', e => { asyncErr = e; });

new Function(coreCode)();          // sets window.CORE
let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n); };
const settle = () => new Promise(r => setTimeout(r, 120));
const boot = () => { for (const k in els) els[k]._handlers = {}; new Function(uiCode).call(global); };
const tsm = t => '08-24 ' + String(10 + Math.floor(t/3600000)).padStart(2,'0') + ':' +
  String(Math.floor(t/60000)%60).padStart(2,'0') + ':' + String(Math.floor(t/1000)%60).padStart(2,'0') + '.' + String(t%1000).padStart(3,'0');
const fireBadge = run => { const spy = { called: false };
  const ev = { target: { closest: s => s === '.runcount' ? { dataset: { run } } : null },
               stopPropagation(){ spy.called = true; }, preventDefault(){} };
  for (const fn of (el('vBody')._handlers.click || [])) fn(ev);
  return spy; };

(async () => {
  // ================= static checks (markup + CSS) =================
  check('toolbar: vColBtn + vGapBtn sit immediately after #vDlt',
    /<button class="btn sec on" id="vDlt"[^>]*>Δt<\/button>\s*<button class="btn sec" id="vColBtn" title="collapse consecutive repeated lines">≡<\/button>\s*<button class="btn sec" id="vGapBtn" title="jump to the next gap of 5\+ seconds">gap»<\/button>/.test(html));
  check('css: #vColBtn.on joins the toggle-on rule', /#vCase\.on,#vWrap\.on,#vDlt\.on,#vColBtn\.on\{/.test(css));
  check('css: .runcount pill + dimmed .vrow.coll rules present', /\.runcount\{[^}]*cursor:pointer/.test(css) && /\.vrow\.coll\{opacity/.test(css));
  check('css: .dlt.gap warning style present', /\.dlt\.gap\{color:var\(--red\);font-weight:700\}/.test(css));
  check('vRender: Δt >= 5000 gets the gap class; collapse uses loglens.col', /d >= 5000 \? ' gap'/.test(html) && html.includes("loglens.col"));

  // ================= run 1: default OFF + toggle persistence + sig helper =================
  boot();
  check('collapse defaults to OFF (no "on" class)', !el('vColBtn').classList.contains('on'));
  const writes = [];
  global.localStorage.setItem = (k,v) => { writes.push([k,v]); storeMap[k] = String(v); };
  el('vColBtn').onclick();
  check('vColBtn click turns collapse ON and persists "loglens.col"="1"',
    el('vColBtn').classList.contains('on') && writes.some(w => w[0]==='loglens.col' && w[1]==='1'));
  el('vColBtn').onclick();
  check('vColBtn click again turns OFF and persists "loglens.col"="0"',
    !el('vColBtn').classList.contains('on') && writes.some(w => w[0]==='loglens.col' && w[1]==='0'));
  global.localStorage.setItem = (k,v) => { storeMap[k] = String(v); };

  check('sig helper exposed (window.__dnTest.sig), collapses abc123/abc456, differs on xyz',
    window.__dnTest && typeof window.__dnTest.sig === 'function' &&
    window.__dnTest.sig('abc123') === window.__dnTest.sig('abc456') &&
    window.__dnTest.sig('abc123') !== window.__dnTest.sig('xyz') &&
    !/\d/.test(window.__dnTest.sig('abc123')));

  // no file open → clean guard
  el('vGapBtn').onclick();
  check('vGapBtn with no file open toasts a guard message', el('toast').textContent.includes('no file'));

  // ================= run 2: collapse render + badge expansion on the demo =================
  storeMap = { 'loglens.col': '1' };
  boot();
  check('collapse restores ON from persisted "loglens.col"="1"', el('vColBtn').classList.contains('on'));

  // small demo-shaped file: group A ×3 (same shape), single B, group C ×2
  // (trailing newline: an unterminated tail line is withheld from the window by design)
  const small = [
    tsm(0) + '  0100  0100 I TagA: heartbeat ok', tsm(1000) + '  0100  0100 I TagA: heartbeat ok', tsm(2000) + '  0100  0100 I TagA: heartbeat ok',
    tsm(3000) + '  0100  0100 W TagB: single event',
    tsm(4000) + '  0100  0100 E TagC: twice repeated', tsm(5000) + '  0100  0100 E TagC: twice repeated',
  ].join('\n') + '\n';
  CORE.DEMO = small;
  el('tabBtnView').onclick();
  el('btnDemo').onclick();
  await settle();

  let body = el('vBody').innerHTML;
  check('collapse ON renders one row per run with count badges (× 3, × 2) and dimmed class',
    (body.match(/class="runcount"/g) || []).length === 2 && body.includes('× 3') && body.includes('× 2') &&
    body.includes('class="vrow coll" data-byte="0" data-idx="0"'));
  check('collapsed rows keep data-byte/data-idx of the first line', /data-byte="0" data-idx="0"/.test(body) && /class="vrow coll"/.test(body));

  const spy = fireBadge('0');
  body = el('vBody').innerHTML;
  check('badge click expands that run (× 3 gone, × 2 stays) and stops propagation (copy handler shielded)',
    spy.called && !body.includes('× 3') && body.includes('× 2') &&
    (body.match(/heartbeat ok/g) || []).length === 3);   // parsed rows split tag/message spans
  fireBadge('0');
  check('badge click again re-collapses the run', el('vBody').innerHTML.includes('× 3'));

  // ================= run 3: gap scan over a file larger than one window =================
  storeMap = {};
  boot();
  const N = 2000;
  const big = [];
  for (let i = 0; i < N; i++){
    const t = (i === 1200 ? 1200 * 1000 + 30000 : i * 1000);   // +30s jump at line 1200
    big.push(tsm(t) + '  0100  0100 I TagA: filler entry ' + String(i).padStart(5,'0') + (i === 1200 ? ' gapline marker' : ' payload abcdefghijklmnop'));
  }
  CORE.DEMO = big.join('\n');
  el('tabBtnView').onclick();
  el('btnDemo').onclick();
  await settle();
  check('run 3 setup: big demo loaded past one window', el('vBody').innerHTML.includes('filler entry') && !el('vBody').innerHTML.includes('gapline marker'));

  asyncErr = null;
  await el('vGapBtn').onclick();
  await settle();
  check('gap scan jumps to the 5s+ gap line and toasts "gap: 31.0s at 08-24 10:20:30"',
    !asyncErr && el('toast').textContent === 'gap: 31.0s at 08-24 10:20:30' && el('vBody').innerHTML.includes('gapline marker'));
  check('gap scan clears its progress status', el('vStatus').textContent === '');

  // no gap ahead: fresh view at EOF of the small file
  storeMap = {};
  boot();
  CORE.DEMO = small;
  el('tabBtnView').onclick();
  el('btnDemo').onclick();
  await settle();
  await el('vGapBtn').onclick();
  check('gap scan at EOF toasts "no 5s+ gap ahead"', el('toast').textContent === 'no 5s+ gap ahead');

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
