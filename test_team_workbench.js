/* team_workbench test harness: stub-based like test_viewer_ui.js.
   Covers the workbench team's features:
     F1  #piiDets/#piiDetBox markup + renderPiiDets (one checkbox per detector,
         toggle flips CORE.PII_DETECTORS.enabled + persists to localStorage
         'loglens.piid', stored map applied on load)
     F2  scheduleRerun: gated (no result -> never runs), debounced re-run
         from the optCtx/optCap input handler
     F3  run() stores S.rulesSnapshot; renderFilterChips prepends the
         'settings changed' chip when rules differ (existing chips intact). */
'use strict';
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'loglens.html'), 'utf8');
const coreCode = /<script id="core">([\s\S]*?)<\/script>/.exec(html)[1];
const uiMatches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
const uiCode = uiMatches.map(m => m[1]).join('\n');

let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n); };

// ---- DOM stubs (memoized per id; event listeners recorded for dispatch) ----
const els = {};
function el(id){
  if (els[id]) return els[id];
  const listeners = {};
  const e = {
    id, style: { setProperty(){} }, dataset: {}, children: [], value: '', textContent: '', innerHTML: '',
    disabled: false, checked: false, title: '', placeholder: '', open: false, scrollTop: 0, clientHeight: 300, className: '',
    classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
                 toggle(c,f){ if(f===undefined){ this._s.has(c)?this._s.delete(c):this._s.add(c); } else if(f) this._s.add(c); else this._s.delete(c); },
                 contains(c){ return this._s.has(c); } },
    _listeners: listeners, _qs: {},
    setAttribute(){}, appendChild(c){ this.children.push(c); },
    addEventListener(t,f){ (listeners[t]=listeners[t]||[]).push(f); },
    removeEventListener(){},
    querySelector(sel){ if(!this._qs['q:'+sel]) this._qs['q:'+sel]=el(id+'$q:'+sel); return this._qs['q:'+sel]; },
    querySelectorAll(sel){ if(!this._qs['a:'+sel]) this._qs['a:'+sel]=[el(id+'$a0:'+sel),el(id+'$a1:'+sel),el(id+'$a2:'+sel),el(id+'$a3:'+sel)]; return this._qs['a:'+sel]; },
    click(){}, scrollIntoView(){}, insertAdjacentHTML(){},
    getBoundingClientRect(){ return { top: 0 }; },
  };
  let _html = '';   // mimic DOM: box.innerHTML='' drops the previous chip elements
  Object.defineProperty(e, 'innerHTML', { get: () => _html, set(v){ _html = String(v); if (!_html) e.children.length = 0; } });
  els[id] = e;
  return e;
}
const fire = (e, t) => (e._listeners[t] || []).forEach(f => f({ target: e, preventDefault(){}, closest(){ return null; } }));

global.document = {
  getElementById: el,
  createElement: tag => el('created<' + tag + '>#' + Math.random()),
  head: { appendChild(){} },
  body: { setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){}, dataset:{}, style:{ setProperty(){} } },
  querySelectorAll: () => [],
};
global.window = global;
global.addEventListener = () => {};
global.localStorage = { _m: {},
  getItem(k){ return Object.prototype.hasOwnProperty.call(this._m, k) ? this._m[k] : null; },
  setItem(k,v){ this._m[k] = String(v); },
  removeItem(k){ delete this._m[k]; } };
const alerts = [];
global.alert = m => { alerts.push(String(m)); };
if (typeof File === 'undefined') global.File = class extends Blob { constructor(parts, name, opts){ super(parts, opts); this.name = name; this.lastModified = Date.now(); } };

new Function(coreCode + '\nreturn CORE;')();
const CORE = global.CORE;

// boot(): fresh UI-script evaluation against empty stubs (localStorage survives)
function boot(){
  for (const k of Object.keys(els)) delete els[k];
  new Function(uiCode).call(global);
  el('tabWork').style.display = '';
  el('tabView').style.display = 'none';
  el('tabPii').style.display = 'none';
}
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---- F1: markup ----
  check('#piiDets + #piiDetBox present in markup', /id="piiDets"[^>]*><summary>detectors<\/summary><div id="piiDetBox"><\/div><\/details>/.test(html) && (html.match(/id="piiDets"/g) || []).length === 1);
  check('#piiDets placed immediately before the #piiStop button', /id="piiDetBox"><\/div><\/details>\s*<button class="btn sec" id="piiStop"/.test(html));

  // ---- F1: renderPiiDets + toggle + persistence ----
  boot();
  const box = el('piiDetBox');
  check('renderPiiDets ran at wiring time: one checkbox+label per detector',
    box.children.length === CORE.PII_DETECTORS.length &&
    box.children.every(c => /<input type="checkbox"/.test(c.innerHTML) && c.textContent === ''));
  const vinLab = box.children[0], javaLab = box.children.find(c => c.innerHTML.includes('Java package (com.*)'));
  check('checkbox checked state mirrors d.enabled', /<input type="checkbox" checked>/.test(vinLab.innerHTML) && !/<input type="checkbox" checked>/.test(javaLab.innerHTML));
  const vinCb = vinLab._qs['q:input'], javaCb = javaLab._qs['q:input'];
  vinCb.checked = false; vinCb.onchange();
  check('toggling flips CORE.PII_DETECTORS.enabled', CORE.PII_DETECTORS[0].enabled === false);
  const saved = JSON.parse(global.localStorage.getItem('loglens.piid') || '{}');
  check('toggle persists name->bool map to localStorage[loglens.piid]',
    saved['VIN (17 chars)'] === false && Object.keys(saved).length === CORE.PII_DETECTORS.length);
  javaCb.checked = true; javaCb.onchange();
  check('re-toggling persists too', CORE.PII_DETECTORS.find(d=>d.name==='Java package (com.*)').enabled === true && JSON.parse(global.localStorage.getItem('loglens.piid'))['Java package (com.*)'] === true);

  // ---- F1: stored map applied on load ----
  boot();
  check('stored map applied on load (disabled detector stays off, re-enabled one stays on)',
    CORE.PII_DETECTORS[0].enabled === false && !/<input type="checkbox" checked>/.test(el('piiDetBox').children[0].innerHTML) &&
    CORE.PII_DETECTORS.find(d=>d.name==='Java package (com.*)').enabled === true);
  delete global.localStorage._m['loglens.piid'];

  // ---- F2/F3: run + scheduleRerun + stale-settings chip ----
  boot();
  let statWrites = 0, sv = '';
  Object.defineProperty(el('statCards'), 'innerHTML', { get: () => sv, set: v => { statWrites++; sv = v; } });

  el('optCtx').value = '2'; fire(el('optCtx'), 'input');         // no result yet -> gated, must not run
  await wait(650);
  check('scheduleRerun gated: no run() without an existing S.result', statWrites === 0 && alerts.length === 0);

  el('btnDemo').onclick();
  await el('btnRun').onclick();                                  // full headless run over the demo file
  check('run() completed under stubs', el('resCard').style.display === '' && statWrites === 1 && alerts.length === 0);

  el('extPreset').value = 'crash'; el('extPreset').onchange();   // rules now differ from the post-run snapshot
  el('tsFrom').value = '08-24 15:37';
  fire(el('resFilter'), 'input');                                // re-renders the chips
  const chips = el('filterChips').children;
  check('stale-settings chip prepended when rules differ from S.rulesSnapshot',
    chips.length >= 2 && (chips[0].textContent || '').includes('settings changed') && (chips[0].textContent || '').includes('press run'));
  check('existing chips still render next to it', (chips[1].textContent || '').includes('⏱'));

  await chips[0].onclick();                                      // chip click = run() -> snapshot refreshed
  fire(el('resFilter'), 'input');
  check('clicking the stale chip re-runs and clears it (snapshot refreshed)',
    el('filterChips').children.every(c => !(c.textContent || '').includes('settings changed')) &&
    el('filterChips').children.some(c => (c.textContent || '').includes('⏱')) && statWrites === 2);

  fire(el('optCtx'), 'input');                                   // scheduleRerun: 450ms debounce -> run()
  await wait(750);
  check('scheduleRerun debounces then re-runs from the optCtx/optCap input handler', statWrites === 3 && alerts.length === 0);

  check('no unexpected alerts', alerts.length === 0);
  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e); process.exit(1); });
