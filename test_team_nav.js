/* team nav suite: structural + functional checks for the viewer go-to-time input
   (#vTimeIn) and boot segmentation (#vBootBtn/#vBootSel). Modelled on
   test_viewer_ui.js's DOM-stub approach: run CORE + the UI script against stubs,
   then drive window.__navTest internals (tsAtByte / bisect) over the demo file
   and a synthetic in-memory V-like state. */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'loglens.html'), 'utf8');
const coreCode = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const uiCode = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

// ---- DOM stubs (same shape as test_viewer_ui.js) ----
function el(id){
  if (els[id]) return els[id];
  const e = {
    id, style: { setProperty(){} }, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
    disabled: false, checked: true, title: '', placeholder: '', scrollTop: 0, clientHeight: 300, className: '',
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
                 toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c); } else if(f) this._s.add(c); else this._s.delete(c); },
                 contains(c){ return this._s.has(c); } },
    setAttribute(){}, appendChild(c){ this.children.push(c); },
    addEventListener(){}, removeEventListener(){},
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
  body: (() => { const a = {}; return { setAttribute(n,v){ a[n]=String(v); }, getAttribute(n){ return Object.prototype.hasOwnProperty.call(a,n) ? a[n] : null; }, removeAttribute(n){ delete a[n]; }, dataset: {}, style: { setProperty(){} } }; })(),
};
global.window = global;
global.addEventListener = () => {};
global.localStorage = { getItem: () => null, setItem(){}, };
global.alert = m => { throw new Error('alert called: ' + m); };

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n); };

// ---- structural: toolbar additions sit before #vStatus ----
const statusIx = html.indexOf('<span id="vStatus"');
check('id vTimeIn present in toolbar (before vStatus)', html.includes('id="vTimeIn"') && html.indexOf('id="vTimeIn"') < statusIx);
check('id vBootBtn present in toolbar (before vStatus)', html.includes('id="vBootBtn"') && html.indexOf('id="vBootBtn"') < statusIx);
check('id vBootSel present in toolbar (before vStatus)', html.includes('<select id="vBootSel"') && html.indexOf('id="vBootSel"') < statusIx);
check('vTimeIn has the specified width + placeholder', /id="vTimeIn"[^>]*style="width:150px"[^>]*placeholder="go to time \+90s \/ -5m \/ 08-25 14:03"/.test(html.replace(/·/g, '')) || /id="vTimeIn"[^>]*placeholder="go to time/.test(html) && /id="vTimeIn"[^>]*style="width:150px"/.test(html));
check('vBootBtn styled "btn sec" with boots text + reset title', /<button class="btn sec" id="vBootBtn" title="scan for reboot boundaries \(timestamp resets\)">boots<\/button>/.test(html));

// ---- run CORE + UI ----
new Function(coreCode + '\nreturn CORE;')();
new Function(uiCode).call(global);
const nav = global.window.__navTest;

check('__navTest exposes bisect + tsAtByte + helpers', !!nav && typeof nav.bisect === 'function' && typeof nav.tsAtByte === 'function' && typeof nav.stub === 'function');
check('relative offsets parse (+90s/-5m/+2h/-1m30s)', nav.rel('+90s') === 90000 && nav.rel('-5m') === -300000 && nav.rel('+2h') === 7200000 && nav.rel('-1m30s') === -90000);
check('relative rejects garbage', nav.rel('90s') === null && nav.rel('+1x') === null && nav.rel('abc') === null);
check('canonical normalization pads to MM-DD HH:MM:SS.mmm', nav.norm('08-25 14:03') === '08-25 14:03:00.000' && nav.norm('08-25 14:03:01') === '08-25 14:03:01.000' && nav.norm('08-25 14:03:01.5') === '08-25 14:03:01.500');

(async () => {
  // switch to the viewer tab and load the demo (gives V a real File)
  el('tabView').style.display = '';
  el('tabWork').style.display = 'none';
  el('btnDemo').onclick();
  await new Promise(r => setTimeout(r, 150));

  const at0 = await nav.tsAtByte(0);
  check('tsAtByte(0) parses the demo file to a canonical ts', !!at0 && /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/.test(at0.ts) && at0.byte === 0);

  // ---- bisect over a synthetic in-memory V-like state (strictly increasing ts) ----
  const p2 = n => String(n).padStart(2, '0');
  const mkTs = s => '08-24 ' + p2(10 + Math.floor(s / 3600)) + ':' + p2(Math.floor(s / 60) % 60) + ':' + p2(s % 60) + '.000';
  const lines = [];
  for (let i = 0; i < 4000; i++) lines.push(mkTs(i) + '  100  200 D Tag: synthetic message ' + i);
  const off = i => lines.slice(0, i).reduce((a, l) => a + l.length + 1, 0);   // ASCII → 1 byte/char
  const content = lines.join('\n') + '\n';
  const file = new File([content], 'synthetic.log', { type: 'text/plain' });
  const restore = nav.stub(file, file.size);
  try {
    const mid = await nav.tsAtByte(off(50));
    check('synthetic tsAtByte lands on the first complete line at/after the byte', !!mid && mid.ts === mkTs(51) && mid.byte === off(51));
    const hit = await nav.bisect(mkTs(100));
    check('bisect finds the exact offset of the first line >= target', !!hit && hit.byte === off(100) && hit.ts === mkTs(100));
    const between = await nav.bisect('08-24 10:01:40.500');                   // between line 100 and 101
    check('bisect for an in-between target lands on the next line', !!between && between.byte === off(101) && between.ts === mkTs(101));
    const early = await nav.bisect('08-24 09:00:00.000');                     // before everything → file start
    check('bisect for a pre-file target returns the first line', !!early && early.byte === off(0));
    const late = await nav.bisect('08-24 23:59:59.999');                      // after everything → nearest preceding line
    check('bisect for an after-EOF target returns the last line', !!late && late.ts === mkTs(3999));
  } finally { restore(); }

  // ---- boot scan over a synthetic file with a timestamp reset at line 2000 ----
  lines[2000] = '08-24 09:30:00.000  100  200 D Tag: reboot — clock went backwards';
  const bootFile = new File([lines.join('\n') + '\n'], 'boots.log', { type: 'text/plain' });
  const restore2 = nav.stub(bootFile, bootFile.size);
  try {
    await el('vBootBtn').onclick();
    await new Promise(r => setTimeout(r, 50));
    const sel = el('vBootSel');
    check('boot scan found the reset and populated the select', sel.children.length === 2 && String(sel.children[1].value) === '1');
    check('boot options carry MM-DD HH:MM labels', sel.children[0].textContent === 'boot 0 — 08-24 10:00' && sel.children[1].textContent === 'boot 1 — 08-24 09:30');
    check('boot 1 records the reset line ts', sel.children[1].textContent.includes('08-24 09:30'));
    check('status line reports the boot count', el('vStatus').textContent === 'boots: 1 found');
  } finally { restore2(); }

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SUITE ERROR:', e); console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed'); process.exit(1); });
