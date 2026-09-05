/* Headless harness (stub-based, like test_viewer_ui.js) for the team: marks
   per-file bookmark feature: toolbar wiring, per-file pin store, pin via the
   'b' keydown path, jump, delete, clipboard copy. */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'loglens.html'), 'utf8');
const coreCode = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const uiCode = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

// ---- DOM stubs ----
function el(id){
  if (els[id]) return els[id];
  const e = {
    id, style: { setProperty(){} }, dataset: {}, children: [], value: '', textContent: '',
    disabled: false, checked: true, title: '', placeholder: '', scrollTop: 0, clientHeight: 300, className: '',
    tagName: 'DIV',
    get parentElement(){ return el(id + '>parent'); },
    _html: '',
    get innerHTML(){ return e._html; },
    set innerHTML(v){ e._html = v; if (v === '') e.children.length = 0; },
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
                 toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c); } else if(f) this._s.add(c); else this._s.delete(c); },
                 contains(c){ return this._s.has(c); } },
    setAttribute(){}, appendChild(c){ this.children.push(c); },
    addEventListener(type, fn){ (e._ls[type] = e._ls[type] || []).push(fn); },
    removeEventListener(){},
    _ls: {},
    fire(type, ev){ (e._ls[type] || []).forEach(fn => fn(ev)); },
    getBoundingClientRect(){ return { top: 0, left: 0, right: 100, bottom: 300, width: 100, height: 300 }; },
    querySelector(sel){ return el(id + '>' + sel); },
    querySelectorAll(){ return [el(id+'>a'), el(id+'>b'), el(id+'>c'), el(id+'>d')]; },
    click(){},
    scrollIntoView(){},
  };
  els[id] = e;
  return e;
}
const els = {};
global.document = {
  getElementById: el,
  createElement: tag => el('create:' + tag + ':' + Math.random()),
  head: { appendChild(){} },
  activeElement: null,
  body: (() => { const a = {}; return { setAttribute(n,v){ a[n]=String(v); }, getAttribute(n){ return Object.prototype.hasOwnProperty.call(a,n) ? a[n] : null; }, removeAttribute(n){ delete a[n]; }, dataset: {}, style: { setProperty(){} } }; })(),
};
global.window = global;
global.addEventListener = () => {};
const LS = {};
global.localStorage = {
  getItem: k => (k in LS ? LS[k] : null),
  setItem: (k, v) => { LS[k] = String(v); },
  removeItem: k => { delete LS[k]; },
};
global.alert = m => { throw new Error('alert called: ' + m); };

// clipboard stub
let clipboardText = null;
const clip = { writeText(t){ clipboardText = t; return Promise.resolve(); } };
try { global.navigator.clipboard = clip; }
catch (e) { Object.defineProperty(global, 'navigator', { value: { clipboard: clip }, configurable: true }); }

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n); };
const settle = ms => new Promise(r => setTimeout(r, ms));

// ---- run CORE + UI ----
const CORE = new Function(coreCode + '\nreturn CORE;')();
new Function(uiCode).call(global);

(async () => {
  // structural: the three toolbar ids sit immediately before #vDlt
  const iSel = html.indexOf('id="vMarksSel"'), iDel = html.indexOf('id="vMarkDel"'),
        iCopy = html.indexOf('id="vMarkCopy"'), iDlt = html.indexOf('id="vDlt"');
  check('toolbar ids present and ordered immediately before vDlt', iSel > 0 && iSel < iDel && iDel < iCopy && iCopy < iDlt);
  check('pin store key literal loglens.pins:<name>:<size> used', /loglens\.pins:'\s*\+\s*V\.file\.name\s*\+\s*':'\s*\+\s*V\.file\.size/.test(uiCode));
  check('vOpen wrapped to refresh marks on file open', /const __origVOpen = vOpen;/.test(uiCode));

  const size = new TextEncoder().encode(CORE.DEMO).length;
  const pinKey = 'loglens.pins:demo_sample.log:' + size;

  // pre-seed one pin, then open the demo — the wrapped vOpen must repopulate the select
  LS[pinKey] = JSON.stringify([{ byte: 4321, text: 'seeded pin line' }]);
  el('tabView').style.display = '';
  el('tabWork').style.display = 'none';
  el('btnDemo').onclick();
  await settle(150);
  const sel = el('vMarksSel');
  check('file-open hook shows the cluster for a file with pins', sel.style.display === '' && el('vMarkDel').style.display === '');
  check('select holds header + seeded pin (label "#byte · snippet")',
    sel.children.length === 2 && sel.children[0].disabled === true && sel.children[0].textContent === 'bookmarks (1)' &&
    sel.children[1].value === '4321' && sel.children[1].textContent === '4321 · seeded pin line');

  // focus guard: 'b' ignored while an input has focus
  const inp = el('vSearch'); inp.tagName = 'INPUT';
  document.activeElement = inp;
  el('vBody').fire('keydown', { key: 'b', ctrlKey: false, altKey: false, metaKey: false, preventDefault(){} });
  check("'b' ignored while focus is in an input", JSON.parse(LS[pinKey]).length === 1);

  // pin via the 'b' keydown path (vBody focused; center row is faked)
  document.activeElement = el('vBody');
  el('vBody').children = [{ dataset: { byte: '1234', idx: '0' }, getBoundingClientRect(){ return { top: 100, bottom: 120, height: 20 }; } }];
  el('vBody').fire('keydown', { key: 'b', ctrlKey: false, altKey: false, metaKey: false, preventDefault(){} });
  let pins = JSON.parse(LS[pinKey] || '[]');
  check("'b' keydown pins the centered row into the store", pins.length === 2 && pins.some(p => p.byte === 1234) && typeof pins.find(p => p.byte === 1234).text === 'string');
  check('pins kept sorted by byte', pins[0].byte === 1234 && pins[1].byte === 4321);

  // duplicate byte is not pinned twice
  el('vBody').fire('keydown', { key: 'B', ctrlKey: false, altKey: false, metaKey: false, preventDefault(){} });
  check("duplicate 'B' does not double-pin", JSON.parse(LS[pinKey]).length === 2);
  check('pin toast shown', el('toast').textContent.indexOf('bookmarked') >= 0);

  // jump: selecting the option seeks and toasts the snippet
  sel.value = '1234';
  sel.onchange();
  await settle(150);
  const want = pins.find(p => p.byte === 1234).text.slice(0, 60);
  check('select jump toasts the pinned snippet', el('toast').textContent === want);

  // delete the selected bookmark
  sel.value = '1234';
  el('vMarkDel').onclick();
  pins = JSON.parse(LS[pinKey]);
  check('del removes the selected pin and persists', pins.length === 1 && pins[0].byte === 4321);

  // copy: all pinned lines joined one per line
  el('vBody').children = [{ dataset: { byte: '1234', idx: '0' }, getBoundingClientRect(){ return { top: 100, bottom: 120, height: 20 }; } }];
  el('vBody').fire('keydown', { key: 'b', ctrlKey: false, altKey: false, metaKey: false, preventDefault(){} });
  pins = JSON.parse(LS[pinKey]);
  el('vMarkCopy').onclick();
  await settle(10);
  check('copy writes joined pin text to the clipboard', clipboardText === pins.map(p => p.text).join('\n'));
  check('copy success toast', el('toast').textContent === pins.length + ' bookmarked lines copied \u2713');

  // emptying the store hides the whole cluster
  sel.value = '1234';
  el('vMarkDel').onclick();
  sel.value = '4321';
  el('vMarkDel').onclick();
  check('cluster hidden when the file has no pins',
    JSON.parse(LS[pinKey]).length === 0 && sel.style.display === 'none' && el('vMarkDel').style.display === 'none' && el('vMarkCopy').style.display === 'none');

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
