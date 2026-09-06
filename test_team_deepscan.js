/* team_deepscan test harness: stub-based like test_team_workbench.js.
   Covers the deep-scan (v1.21) UI wiring:
     D1  consent gate: dsRun refuses without #dsAllow (no fetch, alert only)
     D2  LLM engine: masked sample is batched to the AI-wizard connection,
         findings render, apply appends validated rules to S.maskRules
     D3  presidio engine: /analyze offsets map to findings with patterns
     D4  busy gating: dsRun disables the other run buttons while active,
         and dsSetBusy(false) re-enables per its own conditions
   The stub env has no Worker, so sampling exercises the in-page fallback
   (same masking + bias logic as the worker driver). */
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
  let _html = '';
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

function boot(){
  for (const k of Object.keys(els)) delete els[k];
  new Function(uiCode).call(global);
  el('tabWork').style.display = '';
  el('tabView').style.display = 'none';
  el('tabPii').style.display = 'none';
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const llmBody = JSON.stringify({ findings: [
  { type:'person name', description:'customer full name', examples:['Alice Smith'],
    suggestedPattern:'\\bAlice Smith\\b', suggestedReplace:'[name]' } ] });
let llmCalls = [];
function stubLlmFetch(){
  llmCalls = [];
  global.fetch = async (url, opts) => {
    llmCalls.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok:true, status:200, json: async () => ({ choices:[{ message:{ content: llmBody } }] }), text: async () => 'ok' };
  };
}

(async () => {
  // ---- D1: consent gate ----
  boot();
  stubLlmFetch();
  el('btnDemo').onclick();                       // demo file loaded
  el('dsEngine').value = 'llm';
  el('aiModel').value = 'test-model';
  el('dsAllow').checked = false;
  await el('dsRun').onclick();
  check('D1: dsRun refused without consent (alert, no fetch)',
    alerts.length === 1 && alerts[0].includes('consent') && llmCalls.length === 0);

  // ---- D2: LLM engine end-to-end under stubs ----
  boot();
  stubLlmFetch();
  el('btnDemo').onclick();
  el('dsEngine').value = 'llm';
  el('aiModel').value = 'test-model';
  el('dsAllow').checked = true;
  fire(el('dsAllow'), 'change');
  const runP = el('dsRun').onclick();            // sync prefix: dsSetBusy(true) ran
  check('D4: dsRun disables the other run buttons while active',
    el('piiRun').disabled === true && el('msRun').disabled === true && el('btnRun').disabled === true);
  await runP;
  check('D4: other run buttons re-enabled after completion',
    el('piiRun').disabled === false && el('msRun').disabled === false);
  check('D2: sample sent to the AI-wizard connection (/chat/completions)',
    llmCalls.length >= 1 && llmCalls[0].url.endsWith('/chat/completions') &&
    llmCalls[0].body.model === 'test-model');
  check('D2: request carries the deep system prompt + masked lines (no raw VIN)',
    llmCalls[0].body.messages[0].role === 'system' && llmCalls[0].body.messages[0].content.includes('ALREADY been masked') &&
    llmCalls.every(c => !JSON.stringify(c.body).includes('YV4DEM0123AB34567')));
  check('D2: the demo tail line (file has no trailing newline) made it into the sample',
    llmCalls.some(c => JSON.stringify(c.body).includes('vel=0.0')));
  check('D2: findings rendered', el('dsFindings').innerHTML.includes('person name') &&
    el('dsFindings').innerHTML.includes('Alice Smith') && el('dsActs').style.display === 'flex');
  global.document.querySelectorAll = () => [{ dataset: { i:'0' }, checked: true }];
  el('dsApply').onclick();
  check('D2: apply appends a validated rule (toast + rule count)',
    el('toast').textContent.includes('deep-scan mask rule(s) appended') && el('toast').textContent.startsWith('1 '));
  await wait(450);
  const prof = JSON.parse(global.localStorage.getItem('loglens.profile') || '{}');
  check('D2: appended rule persisted to the profile (debounced save)',
    (prof.mask || []).some(r => r.name === 'deep: person name' && r.pattern === '\\bAlice Smith\\b' && r.replace === '[name]'));

  // ---- D3: presidio engine end-to-end under stubs ----
  boot();
  let presiBodies = [];
  global.fetch = async (url, opts) => {
    presiBodies.push({ url: String(url), body: JSON.parse(opts.body) });
    return { ok:true, status:200, json: async () => ({ results: [
      { start: 0, end: 15, entity_type: 'EMAIL_ADDRESS', score: 0.91 },
      { start: 0, end: 6,  entity_type: 'PERSON', score: 0.88 } ] }), text: async () => 'ok' };
  };
  el('btnDemo').onclick();
  el('dsEngine').value = 'presidio';
  el('dsUrl').value = 'http://localhost:3000';
  el('dsAllow').checked = true;
  fire(el('dsAllow'), 'change');
  await el('dsRun').onclick();
  check('D3: presidio batches POST to <url>/analyze',
    presiBodies.length >= 1 && presiBodies[0].url === 'http://localhost:3000/analyze' &&
    typeof presiBodies[0].body.text === 'string' && presiBodies[0].body.language === 'en');
  check('D3: presidio findings render, structured type carries a pattern',
    el('dsFindings').innerHTML.includes('EMAIL_ADDRESS') && el('dsFindings').innerHTML.includes('presidio EMAIL_ADDRESS'));
  check('D3: consent + engine persisted (allow never persisted)',
    (() => { const p = JSON.parse(global.localStorage.getItem('loglens.deep') || '{}');
             return p.engine === 'presidio' && p.url === 'http://localhost:3000' && p.allow === undefined; })());

  // ---- D2b: engine=off refuses with an alert ----
  boot();
  stubLlmFetch();
  el('btnDemo').onclick();
  el('dsEngine').value = 'off';
  el('dsAllow').checked = true;
  fire(el('dsAllow'), 'change');
  check('D1b: dsRun disabled when engine off', el('dsRun').disabled === true);
  await el('dsRun').onclick();
  check('D1b: dsRun refused with engine off (no fetch)', llmCalls.length === 0 && alerts.some(a => a.includes('Pick an engine')));

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('DEEPSCAN HARNESS ERROR:', e); process.exit(2); });
