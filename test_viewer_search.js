/* Regression: viewer tab search (vSearch/vFind) must actually scan the file,
   jump to and highlight matches, and report "no matches" only when none exist.
   Guards against the vFind rewrite that referenced undefined identifiers
   (V.lastByte / V.firstByte / V_ENC / vResetAt / vUpdateStatus). */
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
    id, style: {}, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
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

// ---- synthetic log: ~8000 lines (~700KB, spans multiple V_CHUNK reads) ----
const lines = [];
for (let i = 1; i <= 8000; i++){
  const n = String(i).padStart(5, '0');
  lines.push(`08-24 10:00:${String(i % 60).padStart(2,'0')}.${String(i % 1000).padStart(3,'0')}  0100  0100 I TagA: filler entry ${n} payload abcdefghijklmnop`);
}
lines[499]  = '08-24 10:00:10.500  0100  0100 I TagA: NEEDLE alpha appears here';
lines[3999] = '08-24 10:00:40.400  0100  0100 I TagA: NEEDLE beta appears here';

new Function(coreCode)();          // sets window.CORE
CORE.DEMO = lines.join('\n');      // demo button will load the big file
new Function(uiCode).call(global);

function fireSearch(shift){
  const h = el('vSearch')._handlers.keydown || [];
  for (const fn of h) fn({ key: 'Enter', shiftKey: !!shift, preventDefault(){} });
}

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n); };
const settle = () => new Promise(r => setTimeout(r, 120));

(async () => {
  el('tabBtnView').onclick();
  el('btnDemo').onclick();
  await settle();
  check('demo loaded (big log rendered)', el('vBody').innerHTML.includes('filler entry'));

  // forward search from the top window: first NEEDLE beyond the window is "beta" (line 4000)
  el('vSearch').value = 'NEEDLE';
  asyncErr = null; fireSearch(false); await settle();
  check('forward search jumps to match (no crash)', !asyncErr);
  check('matched line rendered in view', el('vBody').innerHTML.includes('NEEDLE beta'));
  check('footer reports search result', el('vFoot').textContent.includes('\uD83D\uDD0D'));
  const betaFoot = el('vFoot').textContent;

  // no further matches after beta
  asyncErr = null; toasts.length = 0; fireSearch(false); await settle();
  check('forward search reports no further matches', el('vFoot').textContent.includes('no matches') && el('vBody').innerHTML.includes('NEEDLE beta'));

  // backward search from beta's window must find "alpha" (line 500, earlier chunk)
  asyncErr = null; fireSearch(true); await settle();
  check('backward search jumps to earlier match (no crash)', !asyncErr);
  check('earlier match rendered in view', el('vBody').innerHTML.includes('NEEDLE alpha'));

  // backward again from the top: nothing before
  asyncErr = null; fireSearch(true); await settle();
  check('backward search at top reports none before view', el('vFoot').textContent.includes('before the current view'));

  // gibberish forward: clean no-match, no crash
  el('vSearch').value = 'ZZZNOSUCHTHINGZZZ';
  asyncErr = null; toasts.length = 0; fireSearch(false); await settle();
  check('no-match pattern reports cleanly (no crash)', !asyncErr && el('vFoot').textContent.includes('no matches'));

  // case-insensitive by default: lowercase needle must match uppercase NEEDLE
  el('vSearch').value = 'needle beta';
  asyncErr = null; fireSearch(false); await settle();
  check('case-insensitive default works', !asyncErr && el('vBody').innerHTML.includes('NEEDLE beta'));

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
