/* Regression: viewer tab search (vSearch/vFind) must actually scan the file,
   jump to and highlight matches, and report "no matches" only when none exist.
   Covers two classes of breakage:
   A) small file / demo log: the whole file sits inside the initial window, so a
      scan that starts past V.winEnd (or before V.winStart) finds nothing — the
      demo-search bug. A match on screen MUST be findable and reported.
   B) large file across chunks: forward walk with the Enter cursor, backward
      chunk-stepping, EOF wrap, case-insensitive default.
   Guards against the earlier vFind rewrite that referenced undefined
   identifiers (V.lastByte / V.firstByte / V_ENC / vResetAt / vUpdateStatus). */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'loglens.html'), 'utf8');
const coreCode = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const uiCode = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

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
    focus(){},
    _handlers: {},
    addEventListener(t, fn){ (this._handlers[t] = this._handlers[t] || []).push(fn); },
    removeEventListener(){},
    querySelector(sel){ return el(id + '>' + sel); },
    querySelectorAll(){ return [el(id+'>a'), el(id+'>b'), el(id+'>c'), el(id+'>d')]; },
    click(){},
    scrollIntoView(){},
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
global.localStorage = { getItem: () => null, setItem(){} };
global.alert = m => { throw new Error('alert called: ' + m); };
const toasts = [];
global.toast = m => toasts.push(m);
let asyncErr = null;
process.on('unhandledRejection', e => { asyncErr = e; });

new Function(coreCode)();          // sets window.CORE
new Function(uiCode).call(global); // fresh UI state (V, S, handlers)

function fireSearch(shift){
  const h = el('vSearch')._handlers.keydown || [];
  for (const fn of h) fn({ key: 'Enter', shiftKey: !!shift, preventDefault(){} });
}

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n); };
const settle = () => new Promise(r => setTimeout(r, 120));
const found = () => el('vFoot').textContent.startsWith('\uD83D\uDD0D');   // 🔍 = a match was located

(async () => {
  // ================= A) demo-scale file: whole file inside the initial window =================
  el('tabBtnView').onclick();
  el('btnDemo').onclick();
  await settle();
  check('A: demo loaded and rendered', el('vBody').innerHTML.length > 0);

  el('vSearch').value = 'MyApp';                   // token that IS on screen in the demo
  asyncErr = null; fireSearch(false); await settle();
  check('A: in-view match is found (demo bug)', !asyncErr && found());
  check('A: no false "no matches"', !el('vFoot').textContent.includes('no matches for'));

  let walks = 0, eof = false;
  while (walks++ < 50){ fireSearch(false); await settle(); if (el('vFoot').textContent.includes('no matches for')) { eof = true; break; } }
  check('A: Enter walks hits then reports EOF once', eof && walks < 50);

  asyncErr = null; fireSearch(true); await settle();
  check('A: backward at top reports none before view', !asyncErr && el('vFoot').textContent.includes('before the current view'));

  // wrap: after EOF the cursor resets, next forward finds the first match again
  asyncErr = null; fireSearch(false); await settle();
  check('A: forward wraps after EOF', !asyncErr && found());

  // ---- clear (✕) button: markup, emptying, cursor reset, fresh re-search ----
  check('clr: markup present (wrapper + button)',
    html.includes('vsearchwrap') && html.includes('id="vSearchClr"') && html.includes('function vClearSearch'));
  asyncErr = null; el('vSearchClr').onclick(); await settle();
  check('clr: query emptied, footer back to the status line', !asyncErr && el('vSearch').value === '' &&
    !found() && !el('vFoot').textContent.includes('no matches for') && /lines/.test(el('vFoot').textContent));
  el('vSearch').value = 'MyApp';
  asyncErr = null; fireSearch(false); await settle();
  check('clr: searching again works from scratch', !asyncErr && found());

  // ================= B) large file across multiple chunk reads =================
  const lines = [];
  for (let i = 1; i <= 8000; i++){
    const n = String(i).padStart(5, '0');
    lines.push(`08-24 10:00:${String(i % 60).padStart(2,'0')}.${String(i % 1000).padStart(3,'0')}  0100  0100 I TagA: filler entry ${n} payload abcdefghijklmnop`);
  }
  lines[499]  = '08-24 10:00:10.500  0100  0100 I TagA: NEEDLE alpha appears here';
  lines[3999] = '08-24 10:00:40.400  0100  0100 I TagA: NEEDLE beta appears here';

  CORE.DEMO = lines.join('\n');
  for (const k in els) els[k]._handlers = {};      // drop run-1 listeners (fresh bootstrap re-registers)
  new Function(uiCode).call(global);               // fresh UI state, empty file list
  el('tabBtnView').onclick();
  el('btnDemo').onclick();
  await settle();
  check('B: big demo loaded (multi-window file)', el('vBody').innerHTML.includes('filler entry'));

  // forward #1: first NEEDLE at/after view top is alpha (line 500)
  el('vSearch').value = 'NEEDLE';
  asyncErr = null; fireSearch(false); await settle();
  check('B: forward finds first match (alpha, in view)', !asyncErr && el('vBody').innerHTML.includes('NEEDLE alpha') && found());

  // forward #2: cursor continues after alpha → beta (line 4000, later chunk)
  asyncErr = null; fireSearch(false); await settle();
  check('B: Enter walks to next match (beta, next chunk)', !asyncErr && el('vBody').innerHTML.includes('NEEDLE beta'));

  // forward #3: past beta → EOF report, beta stays rendered
  asyncErr = null; fireSearch(false); await settle();
  check('B: EOF reports cleanly, view unchanged', !asyncErr && el('vFoot').textContent.includes('no matches for') && el('vBody').innerHTML.includes('NEEDLE beta'));

  // backward from beta's window must find alpha (line 500, earlier chunk)
  asyncErr = null; fireSearch(true); await settle();
  check('B: backward jumps to earlier match (alpha)', !asyncErr && el('vBody').innerHTML.includes('NEEDLE alpha'));

  // backward again: nothing before alpha
  asyncErr = null; fireSearch(true); await settle();
  check('B: backward at top reports none before view', !asyncErr && el('vFoot').textContent.includes('before the current view'));

  // gibberish forward: clean no-match, no crash
  el('vSearch').value = 'ZZZNOSUCHTHINGZZZ';
  asyncErr = null; toasts.length = 0; fireSearch(false); await settle();
  check('B: no-match pattern reports cleanly (no crash)', !asyncErr && el('vFoot').textContent.includes('no matches'));

  // case-insensitive by default: lowercase needle must match uppercase NEEDLE
  el('vSearch').value = 'needle beta';
  asyncErr = null; fireSearch(false); await settle();
  check('B: case-insensitive default works', !asyncErr && el('vBody').innerHTML.includes('NEEDLE beta'));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
