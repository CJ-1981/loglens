/* Node smoke test for loglens.html CORE (no DOM). */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, 'loglens.html'), 'utf8');

// extract the core script block
const m = /<script id="core">([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('FAIL: core script not found'); process.exit(1); }
const CORE = new Function(m[1] + '\nreturn CORE;')();

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name); }
}

console.log('== header parsing ==');
const h1 = CORE.parseHeader("08-24 15:37:34.240  3807  4188 I MyApp:Session: SM: Enter Session::BlockedState state");
check('ts', h1 && h1.ts === '08-24 15:37:34.240');
check('lvl', h1 && h1.lvl === 'I');
check('colon tag', h1 && h1.tag === 'MyApp:Session');
check('msg', h1 && h1.msg === 'SM: Enter Session::BlockedState state');
check('pid/tid', h1 && h1.pid === '3807' && h1.tid === '4188');
const h2 = CORE.parseHeader("E/Tag(123): boom");
check('legacy format', h2 && h2.lvl === 'E' && h2.tag === 'Tag' && h2.pid === '123');
check('non-header', CORE.parseHeader('random text') === null);

console.log('== masking ==');
const cm = CORE.compile(CORE.DEFAULT_MASK, 'mask').map(c => c.error ? c : { ...c, rx: new RegExp(c.rx.source, 'g') });
check('no bad presets', cm.every(c => !c.error));
const tests = [
  ['vin=YV4AB9CD12EF34567 vehicleId=YV4AB9CD12EF34567', /vin=YV4\*{10}4567/, /YV4AB/],
  ['"vehicleId":"YV4AB9CD12EF34567"', /"vehicleId":"YV4\*{10}4567"/, null],
  ['user someone@example.com', /s\*\*\*@\*\*\*/, /example\.com/],
  ['"dID":"SN-abc123def456"', /SN-\*\*\*/, /abc123def456/],
  ['hwAddr: 02:11:22:aa:bb:cc', /02:11:22:\*\*:\*\*:\*\*/, /aa:bb:cc/],
  ['ipv4 192.168.228.100/24', /192\.168\.228\.x/, /228\.100/],
  ['listen [fe80::1111:2222:3333:4444]:53', /IPv6-masked/, /1111:2222/],
  ['subscriberId=123456789012', /subscriberId=\*\*\*/, /123456789012/],
  ['ssid AndroidShare_31415', /AndroidShare_\*\*\*\*/, /31415/],
  ['plain line stays intact', /plain line stays intact/, null],
];
for (const [line, want, forbid] of tests) {
  const out = CORE.maskLine(line, cm).line;
  check('mask: ' + line.slice(0, 30), want.test(out) && (!forbid || !forbid.test(out)));
}
// any 17-char VIN-style token is partially masked by the generic VIN rule
const out2 = CORE.maskLine('vin=1FTFW1ET5DFC12345 x', cm).line;
check('generic vin partial mask', /vin=1FT\*{10}2345/.test(out2));

console.log('== extraction pipeline (demo sample) ==');
const st = CORE.newState();
const opts = {
  include: CORE.compile([{ name: 'demo', pattern: 'myapp', kind: 'include', enabled: true }], 'extract'),
  exclude: [],
  levels: new Set(['V', 'D', 'I', 'W', 'E', 'F']),
  fromTs: null, toTs: null,
  applyMask: true, maskCompiled: cm, hardCap: 100000, bucketMin: 1
};
CORE.processText(CORE.DEMO, 'demo.log', opts, st);
check('total lines counted', st.total === 12);
// include-pattern ('myapp', case-insensitive) matches demo lines 1-5 (the MyApp-tagged ones); lines 6-12 have other tags.
// #7 gms.subscribedfeeds/com.google/someone@example.com - no match.
// #8 netd - no. #9 dnsmasq - no. #10 NetworkPolicy - no. #11 CarProjectionService - no. #12 CctTransportBackend - no.
check('include matches = 5', st.matched === 5);
check('errish counted', st.errish === 1); // the E-level "Auth Error" line only
check('levels recorded', st.byLevel['I'] >= 3 && st.byLevel['E'] === 1);
check('tag map', st.byTag['MyApp:Session'] === 1 && st.byTag['MyApp:Service'] === 1);
check('mask hits counted', (st.maskHits['VIN (17 chars)'] || 0) === 3); // 2 in line2 + 1 in line3
const ex = st.matches.map(r => '[L' + r.lineno + '] ' + r.masked).join('\n');
check('export format', /\[L\d+\] /.test(ex));
check('extract is masked', !/YV4AB9/.test(ex));

console.log('== filters ==');
const st2 = CORE.newState();
CORE.processText(CORE.DEMO, 'demo.log', { ...opts, levels: new Set(['E']) }, st2);
check('level filter E only', st2.matched === 1 && st2.byLevel['E'] === 1);
const st3 = CORE.newState();
CORE.processText(CORE.DEMO, 'demo.log', { ...opts, fromTs: '08-24 15:37' }, st3);
check('time filter from 15:37 -> 4 matches', st3.matched === 4);
const st4 = CORE.newState();
CORE.processText(CORE.DEMO, 'demo.log', { ...opts, exclude: CORE.compile([{ name: 'x', pattern: 'Heartbeat', kind: 'exclude', enabled: true }], 'extract') }, st4);
check('exclude rule', st4.matched === 4);
const st5 = CORE.newState();
CORE.processText(CORE.DEMO, 'demo.log', { ...opts, include: [] }, st5);
check('empty include = mask-all/match-all mode', st5.matched === st5.total && st5.total === 12);

console.log('== auto bucket ==');
check('short span -> 1m', CORE.autoBucket('08-24 12:00:00.000', '08-24 13:00:00.000') === 1);
check('long span -> 10m', CORE.autoBucket('08-24 12:00:00.000', '08-24 18:00:00.000') === 10);

console.log('== AI wizard: extractJSON ==');
check('plain json', CORE.extractJSON('{"a":1}') === '{"a":1}');
check('fenced json', CORE.extractJSON('```json\n{"a":1}\n```') === '{"a":1}');
check('prose-wrapped', CORE.extractJSON('Here you go:\n```\n{"extract":[]}\n```\nEnjoy!') === '{"extract":[]}');
check('braces in strings', CORE.extractJSON('noise {"a":"x{y}z"} tail') === '{"a":"x{y}z"}');
let threw = false; try { CORE.extractJSON('no json here'); } catch (e) { threw = true; }
check('no-json throws', threw);

console.log('== AI wizard: validateProfile ==');
const vp1 = CORE.validateProfile({
  extract: [
    { name: 'bt', pattern: 'bluetooth|bt_', kind: 'include' },
    { name: 'noise', pattern: 'hci_dump', kind: 'exclude', enabled: false },
    { name: 'bad', pattern: '(unclosed' },
  ],
  mask: [
    { name: 'phone', pattern: '\\+\\d{6,14}', replace: '[phone]' },
    { name: 'no-repl', pattern: 'imei\\d*' },
    { name: '', pattern: 'x{' },
  ]
});
check('valid extract kept = 2', vp1.extract.length === 2);
check('bad regex skipped + error', vp1.errors.length === 1 && vp1.errors[0].includes('bad'));
check('kind normalized', vp1.extract[0].kind === 'include' && vp1.extract[1].kind === 'exclude');
check('enabled default true', vp1.extract[0].enabled === true);
check('lone-brace regex tolerated by JS (kept)', vp1.mask.length === 3);
check('default replacement', vp1.mask[1].replace === '[redacted]' && vp1.mask[1].flags === 'g');
const vp2 = CORE.validateProfile(null);
check('null root -> 1 error', vp2.errors.length === 1 && vp2.extract.length === 0);
const vp3 = CORE.validateProfile({ extract: [{ name: 'a', pattern: 'x' }, { name: 'a', pattern: 'y' }] });
check('duplicate names uniquified', vp3.extract[0].name !== vp3.extract[1].name);
// generated profile actually runs through the engine
const stA = CORE.newState();
const cmA = CORE.compile(vp1.mask, 'mask').map(c => ({ ...c, rx: new RegExp(c.rx.source, 'g') }));
CORE.processText('08-24 12:00:00.000  1  1 I bt_stack: pair failed +4512345678 imei356938035643809',
  'a.log', { include: vp1.extract.filter(r=>r.enabled).map(r=>({name:r.name,rx:new RegExp(r.pattern,'i')})), exclude:[], levels:new Set(['I']), applyMask:true, maskCompiled:cmA, hardCap:10, bucketMin:1 }, stA);
check('AI profile runs end-to-end', stA.matched === 1 && /\[phone\]/.test(stA.matches[0].masked));
check('system prompt mentions schema', CORE.SYSTEM_PROMPT.includes('"extract"') && CORE.SYSTEM_PROMPT.includes('"mask"'));

console.log('== v1.5: time filter boundary (prefix compare) ==');
const stB = CORE.newState();
CORE.processText('08-24 19:22:00.000  1  1 I T: myapp in-boundary\n08-24 19:22:59.999  1  1 I T: myapp still-boundary\n08-24 19:23:00.000  1  1 I T: myapp outside',
  'b.log', { ...opts, toTs: '08-24 19:22' }, stB);
check('to includes its own minute', stB.matched === 2);
const stB2 = CORE.newState();
CORE.processText('08-24 15:37:00.000  1  1 I T: myapp from-second\n08-24 15:36:59.999  1  1 I T: myapp before', 'b2.log',
  { ...opts, fromTs: '08-24 15:37' }, stB2);
check('from includes its own second', stB2.matched === 1);

console.log('== v1.5: context lines ==');
const stC = CORE.newState();
const ctxLines = [
  '08-24 10:00:00.000  1  1 I A: one',
  '08-24 10:00:01.000  1  1 I A: two',
  '08-24 10:00:02.000  1  1 E A: boom',
  '08-24 10:00:03.000  1  1 I A: three',
  '08-24 10:00:04.000  1  1 I A: four',
  '08-24 10:00:05.000  1  1 I A: five',
];
CORE.processText(ctxLines.join('\n'), 'c.log',
  { ...opts, include: CORE.compile([{ name: 'boom', pattern: 'boom' }], 'extract'), context: 2 }, stC);
check('ctx records counted', stC.ctxCount === 4);
check('matches still exact', stC.matched === 1);
check('sequence before/before/match/after/after',
  stC.matches.map(r => r.ctx).join(',') === 'before,before,match,after,after');

console.log('== v1.5: single-pass masker $-handling ==');
const cmV = CORE.compile([
  { name: 'g', pattern: '(YV[A-HJ-NPR-Z0-9]{10})([A-HJ-NPR-Z0-9]{4})', replace: '$1**********$2', flags: 'g' },
  { name: 'esc', pattern: '(ab)', replace: '$1 $$ $$1', flags: 'g' },
], 'mask').map(c => ({ ...c, rx: new RegExp(c.rx.source, 'g') }));
const mV = CORE.maskLine('YV4AB9CD12EF34567 ab', cmV);
check('group refs applied', mV.line.startsWith('YV4AB9CD12EF**********3456'));
check('$$ collapses to literal $', mV.line.includes(' $ $1'));
check('hits counted per rule', mV.hits['g'] === 1 && mV.hits['esc'] === 1);

console.log('== v1.5: pickBucketSize ==');
check('24->1 25->5', CORE.pickBucketSize(24) === 1 && CORE.pickBucketSize(25) === 5);
check('48->5 49->10 120->10 121->30', CORE.pickBucketSize(48) === 5 && CORE.pickBucketSize(49) === 10 && CORE.pickBucketSize(120) === 10 && CORE.pickBucketSize(121) === 30);
check('288->30 289->60 672->60 673->360', CORE.pickBucketSize(288) === 30 && CORE.pickBucketSize(289) === 60 && CORE.pickBucketSize(672) === 60 && CORE.pickBucketSize(673) === 360);

console.log('== v1.5: per-file stats + byFile ==');
const stP = CORE.newState();
CORE.processText(CORE.DEMO, 'p1.log', { ...opts }, stP);
CORE.processText('08-24 20:00:00.000  9  9 E Z: other myapp', 'p2.log', { ...opts }, stP);
check('byFile tracked', stP.byFile['p1.log'] && stP.byFile['p1.log'].lines === 12 && stP.byFile['p2.log'].matched === 1);
check('DEFAULT_ERRISH_SOURCE exposed', typeof CORE.ERRISH_SOURCE === 'string' && CORE.ERRISH_SOURCE.includes('exception'));

console.log('== v1.6: readiness + ts validation ==');
const r0 = CORE.readiness(0, 1, 0, 9), r2 = CORE.readiness(2, 1, 0, 9);
check('readiness: no files -> not ok', r0.ok === false && /no files/.test(r0.text));
check('readiness: ready text', r2.ok === true && /2 files/.test(r2.text) && /9 mask rules/.test(r2.text));
check('validTs: empty ok', CORE.validTs('') === true);
check('validTs: minute ok', CORE.validTs('08-24 15:37') === true);
check('validTs: seconds ok', CORE.validTs('08-24 15:37:05') === true);
check('validTs: garbage rejected', CORE.validTs('2026-08-24') === false && CORE.validTs('garbage') === false);

console.log('== v1.7: timestamp auto-detection ==');
check('ISO with ms + Z', CORE.parseHeader('2026-08-24T15:37:01.123Z info: x').ts === '08-24 15:37:01.123');
check('ISO space, no ms', CORE.parseHeader('2026-08-24 15:37:01 worker: done').ts === '08-24 15:37:01.000');
check('syslog RFC3164', CORE.parseHeader('Aug 24 15:37:01 host app[123]: oops').ts === '08-24 15:37:01.000');
check('syslog padded day + ms', CORE.parseHeader('Sep  9 08:05:59.5 myhost crond: tick').ts === '09-09 08:05:59.500');
check('Apache CLF', CORE.parseHeader('[24/Aug/2026:15:37:01 +00:00] "GET /a HTTP/1.1" 200').ts === '08-24 15:37:01.000');
check('bare MM-DD', CORE.parseHeader('08-24 15:37:01 app: started').ts === '08-24 15:37:01.000');
check('no ts -> null', CORE.parseHeader('random text without timestamps') === null);
check('invalid ranges rejected', CORE.parseHeader('99-99 99:99:99 x') === null);
check('lvl/tag null for generic formats', (() => { const h = CORE.parseHeader('Aug 24 15:37:01 host app: x'); return h && h.lvl === null && h.tag === null; })());
check('logcat fast-path intact', (() => { const h = CORE.parseHeader('08-24 15:37:34.240  3807  4188 I MyApp:Session: x'); return h && h.pid === '3807' && h.lvl === 'I'; })());
const stT2 = CORE.newState();
CORE.processText('Aug 24 15:00:01 host a: keep myapp\nAug 24 16:00:01 host a: drop myapp\n2026-08-25T09:00:00.000 svc b: drop myapp', 'g.log',
  { ...opts, toTs: '08-24 23:59' }, stT2);
check('generic formats time-filtered', stT2.matched === 2);
check('generic formats bucketed', Object.keys(stT2.buckets).length === 2);
const stT3 = CORE.newState();
CORE.processText('Aug 24 15:00:01 host a: null-level myapp\n08-24 15:00:02.000  1  1 I T: logcat-level myapp', 'h.log',
  { ...opts, levels: new Set(['E']) }, stT3);
check('null level bypasses level filter', stT3.matched === 1);

console.log('== v1.8: adaptive time-window input ==');
check('parseUserTs canonical minute', CORE.parseUserTs('08-24 15:37') === '08-24 15:37');
check('parseUserTs canonical seconds+ms', CORE.parseUserTs('08-24 15:37:01.5') === '08-24 15:37:01.500');
check('parseUserTs ISO space', CORE.parseUserTs('2026-08-24 15:37') === '08-24 15:37');
check('parseUserTs ISO T + Z + ms', CORE.parseUserTs('2026-08-24T15:37:01.123Z') === '08-24 15:37:01.123');
check('parseUserTs ISO offset', CORE.parseUserTs('2026-08-24 15:37:01+02:00') === '08-24 15:37:01');
check('parseUserTs syslog', CORE.parseUserTs('Aug 24 15:37') === '08-24 15:37');
check('parseUserTs syslog padded day + seconds', CORE.parseUserTs('Sep  9 08:05:59') === '09-09 08:05:59');
check('parseUserTs CLF', CORE.parseUserTs('[24/Aug/2026:15:37]') === '08-24 15:37');
check('parseUserTs rejects garbage', CORE.parseUserTs('yesterday') === null && CORE.parseUserTs('2026-08-24') === null && CORE.parseUserTs('99-99 99:99') === null);
check('validUserTs accepts all families + empty', CORE.validUserTs('') && CORE.validUserTs('Aug 24 15:37') && CORE.validUserTs('2026-08-24 15:37') && !CORE.validUserTs('soon'));
check('detectTsInfo families', CORE.detectTsInfo('2026-08-24T15:37:01Z x').family === 'iso'
  && CORE.detectTsInfo('Aug 24 15:37:01 h a: x').family === 'syslog'
  && CORE.detectTsInfo('[24/Aug/2026:15:37:01] GET').family === 'clf'
  && CORE.detectTsInfo('08-24 15:37:01 app: x').family === 'mmd');
// end-to-end: ISO-format window filters ISO-format log lines
const stT4 = CORE.newState();
CORE.processText('2026-08-24T15:00:01.000Z svc a: iso-in myapp\n2026-08-24T16:30:00.000Z svc a: iso-out myapp', 'i.log',
  { ...opts, toTs: CORE.parseUserTs('2026-08-24 16:00') }, stT4);
check('ISO window filters ISO lines', stT4.matched === 1);

console.log('== v1.6: fonts + logcat themes ==');
check('font selector present', html.includes('id="fontSel"'));
check('webfont opt-in present', html.includes('id="fontWf"'));
check('logcat theme selector present', html.includes('id="logThemeSel"'));
check('--mono variable defined and used', html.includes('--mono:Consolas') && html.includes('var(--mono)'));
const themeIds = ['as','vscode','dracula','solarized','hc'];
check('all 5 logcat preset palettes in CSS', themeIds.every(t => html.includes('data-logtheme="' + t + '"')));
check('preset palettes cover all levels', ['V','D','I','W','E','F'].every(l =>
  themeIds.every(t => html.includes('data-logtheme="' + t + '"] .lv' + l))));
check('theme options present', ['Android Studio','VS Code Dark+','Dracula','Solarized Dark','High Contrast'].every(n => html.includes(n)));
check('header buttons readable on dark bar (light text + transparent bg)', html.includes('header.top .btn.sec,body header.top .btn.sec{color:#e7edf5'));

console.log('== v1.5.1: per-rule case sensitivity ==');
check('extract default insensitive', CORE.compile([{name:'x',pattern:'demo'}],'extract')[0].rx.test('DEMO'));
check('extract ci:false -> sensitive', !(CORE.compile([{name:'x',pattern:'demo',ci:false}],'extract')[0].rx.test('DEMO')));
check('mask default sensitive', !(CORE.compile([{name:'v',pattern:'yv4',flags:'g'}],'mask')[0].rx.test('YV4')));
check('mask ci:true -> insensitive', CORE.compile([{name:'v',pattern:'yv4',ci:true}],'mask')[0].rx.test('YV4'));
const stCS = CORE.newState();
CORE.processText('08-24 10:00:00.000  1  1 I T: MyApp upper\n08-24 10:00:01.000  1  1 I T: myapp lower', 'cs.log',
  { ...opts, include: CORE.compile([{name:'cs',pattern:'myapp',ci:false}],'extract') }, stCS);
check('ci:false end-to-end (exact case only)', stCS.matched === 1 && stCS.matches[0].masked.includes('lower'));
// validator passes ci through
const vpCI = CORE.validateProfile({extract:[{name:'c',pattern:'x',ci:false}], mask:[{name:'m',pattern:'y',ci:true}]});
check('validator: extract ci:false kept', vpCI.extract[0].ci === false);
check('validator: mask ci:true -> flags gi', vpCI.mask[0].flags === 'gi');

console.log('== v1.5.1: DOM id integrity (P0-1 regression) ==');
const ids = new Set([...html.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map(x => x[1]));
const dyn = new Set(['resBody']);   // created in-JS at render time
const missing = [...ids].filter(id => !dyn.has(id) && !html.includes('id="' + id + '"'));
check('every $("id") exists in markup (' + ids.size + ' ids checked)', missing.length === 0);
if (missing.length) console.log('   missing:', missing.join(', '));

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

console.log('== multi-GB safeguards ==');
// hardCap truncation + onMatch sees every match
const stT = CORE.newState();
let onMatchCount = 0;
CORE.processText(CORE.DEMO, 'a.log', { ...opts, hardCap: 2, onMatch: () => onMatchCount++ }, stT);
check('stored matches capped', stT.matches.length === 2);
check('truncated flag set', stT.truncated === true);
check('matched count still exact', stT.matched === 5);
check('onMatch fired for every match', onMatchCount === 5);
// bucket merging at render time
const bm = { '08-24 12:03': 2, '08-24 12:07': 1, '08-24 12:58': 4 };
const m5 = CORE.mergeBuckets(bm, 5);
check('merge 5min', m5['08-24 12:00'] === 2 && m5['08-24 12:05'] === 1 && m5['08-24 12:55'] === 4);
const m10 = CORE.mergeBuckets(bm, 10);
check('merge 10min', m10['08-24 12:00'] === 3 && m10['08-24 12:50'] === 4);
check('no raw duplication in records', !('raw' in stT.matches[0]));

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
