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
  ['call +45 12 34 56 78 now', /\+45 \*\*\*/, /34 56 78/],
  ['phone +1-555-123-4567', /\+1 \*\*\*/, /123-4567/],
  ['US (555) 123-4567 line', /\(555\) \*\*\*-/, /123-4567/],
  ['imei 356938035643809 device', /\[IMEI\]/, /356938035643809/],
  ['ssn 123-45-6789 user', /123-\*\*-\*\*\*\*/, /6789/],
  ['iban DE89370400440532013000 ok', /DE89\*{10}/, /37040044/],
  ['card 4111 1111 1111 1111 pay', /\[card\]/, /4111/],
  ['public ip 203.0.113.42 fwd', /203\.0\.x\.x/, /113\.42/],
  ['ts 08-24 15:37:01.123 unchanged', /15:37:01\.123/, /\[IMEI\]|\[card\]|\*\*\*/],
  ['epoch 1787611054935 ms stays', /1787611054935/, /\[IMEI\]/],
  ['version 2.41.3 stays', /2\.41\.3/, /x\.x/],
  ['tz +0200 stays', /\+0200/, /\*\*\*/],
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
check('total lines counted', st.total === 15);
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
check('empty include = mask-all/match-all mode', st5.matched === st5.total && st5.total === 15);

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
check('byFile tracked', stP.byFile['p1.log'] && stP.byFile['p1.log'].lines === 15 && stP.byFile['p2.log'].matched === 1);
check('DEFAULT_ERRISH_SOURCE exposed', typeof CORE.ERRISH_SOURCE === 'string' && CORE.ERRISH_SOURCE.includes('exception'));

console.log('== v1.6: readiness + ts validation ==');
const r0 = CORE.readiness(0, 1, 0, 9), r2 = CORE.readiness(2, 1, 0, 9);
check('readiness: no files -> not ok', r0.ok === false && /no files/.test(r0.text));
check('readiness: ready text', r2.ok === true && /2 files/.test(r2.text) && /9 mask rules/.test(r2.text));
check('validTs: empty ok', CORE.validTs('') === true);
check('validTs: minute ok', CORE.validTs('08-24 15:37') === true);
check('validTs: seconds ok', CORE.validTs('08-24 15:37:05') === true);
console.log('== v1.12: PII scanner ==');
check('detector catalog present', Array.isArray(CORE.PII_DETECTORS) && CORE.PII_DETECTORS.length >= 12);
const dets = CORE.PII_DETECTORS.map(d => ({ ...d, rx: new RegExp(d.rx.source, d.rx.flags) }));
const scan = line => CORE.scanLinePII(line, dets).map(x => x.name + '=' + x.value);
check('VIN detected', scan('vin YV4AB9CD12EF34567 here').some(x => x.startsWith('VIN (17 chars)=YV4')));
check('IMEI detected', scan('imei 356938035643809 dev').some(x => x.startsWith('IMEI')));
check('email detected', scan('mail someone@example.com done').some(x => x.startsWith('email=someone@example.com')));
check('intl phone detected', scan('call +4512345678 now').some(x => x.startsWith('phone (intl +)=+45')));
check('MAC detected', scan('mac aa:bb:cc:dd:ee:ff end').some(x => x.startsWith('MAC=aa:bb:cc:dd:ee:ff')));
check('private IPv4 detected', scan('ip 192.168.1.50 up').some(x => x.startsWith('IPv4 (any)=192.168.1.50')));
check('public IPv4 detected', scan('ip 203.0.113.42 fwd').some(x => x.startsWith('IPv4 (any)=203.0.113.42')));
check('IPv6 detected', scan('addr fe80::1234:5678 end').some(x => x.startsWith('IPv6')));
check('SSN detected', scan('ssn 123-45-6789 x').some(x => x.startsWith('SSN=123-45-6789')));
check('serial detected', scan('id SN-1a2b3c4d here').some(x => x.startsWith('device serial SN-=SN-1a2b3c4d')));
check('subscriber detected', scan('x subscriberId=123456789 y').some(x => x.startsWith('subscriberId')));
// guards: non-PII must NOT match
const noPII = t => CORE.scanLinePII(t, dets).length === 0;
check('guard: logcat ts not flagged', noPII('08-24 15:37:01.123  4111  7681 I tag: msg'));
check('guard: epoch ms not flagged', noPII('ts=1787611054935 ok'));
check('guard: version not flagged', noPII('version 2.41.3 build 1148'));
check('guard: short hex not flagged', noPII('hash ab12cd34 ok'));
check('guard: plain text not flagged', noPII('nothing personal in this line at all'));
// shape privacy: no full raw values in shapes
const sh = CORE.scanLinePII('YV4AB9CD12EF34567 someone@example.com 356938035643809', dets).map(x => x.shape).join('|');
check('shapes are truncated, never raw', !sh.includes('YV4AB9CD12EF34567') && !sh.includes('someone@example.com') && !sh.includes('356938035643809'));

console.log('== v1.12: PII tab wiring ==');
check('pii tab ids present', ['tabBtnPii','tabPii','piiRun','piiStop','piiFindings','piiApply','piiToAi','piiDl','piiProg','piiStatus'].every(id => html.includes('id="' + id + '"')));
check('setTab handles pii', html.includes("pii:['tabPii','tabBtnPii']"));
check('detectors render with samples + mask column', html.includes('piiRenderFindings') && html.includes('piiPick'));

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
check('ts-bearing null-level line still bypasses level filter (syslog usable)', stT3.matched === 1);

console.log('== continuation-line level inheritance (level chips) ==');
// include=[] so the level filter is the only gate; a stack/continuation line has no
// header of its own and must inherit the level of the preceding parsed line.
const lvlOpts = { ...opts, include: [] };
const stL1 = CORE.newState();
CORE.processText('08-24 15:00:01.000  1  1 D T: myapp start work\n    at com.example.Foo.bar(Foo.java:12)\n    at com.example.Baz.qux(Baz.java:9)', 'l1.log',
  { ...lvlOpts, levels: new Set(['E']) }, stL1);
check('continuation dropped when filtering E only', stL1.matched === 0);
const stL2 = CORE.newState();
CORE.processText('08-24 15:00:01.000  1  1 D T: myapp start work\n    at com.example.Foo.bar(Foo.java:12)', 'l2.log',
  { ...lvlOpts, levels: new Set(['D']) }, stL2);
check('continuation kept when filtering D only (inherits D)', stL2.matched === 2 && stL2.byLevel['D'] === 2 && stL2.matches[1].lvl === 'D');
const stL3 = CORE.newState();
CORE.processText('    orphan stack line before any header\n08-24 15:00:02.000  1  1 E T: myapp boom', 'l3.log',
  { ...lvlOpts, levels: new Set(['E']) }, stL3);
check('continuation with no previous level dropped while filtering', stL3.matched === 1 && stL3.total === 2);
const stL4 = CORE.newState();
CORE.processText('08-24 15:00:01.000  1  1 D T: myapp start work\n    at com.example.Foo.bar(Foo.java:12)', 'l4.log', lvlOpts, stL4);
check('all six levels checked: old behavior, continuation passes', stL4.matched === 2);
const stL5 = CORE.newState();
CORE.processText('08-24 15:00:01.000  1  1 D T: myapp start work\n    at com.example.Foo.bar(Foo.java:12)', 'l5.log',
  { ...lvlOpts, levels: new Set(['E']), include: opts.include }, stL5);
check('continuation inherits level even when its header matched include rules', stL5.matched === 0);
const stL6 = CORE.newState();
CORE.processText('08-24 15:00:01.000  1  1 D F1: d line\n08-24 15:00:02.000  1  1 E F1: e line\n    stack under the E header', 'l6.log',
  { ...lvlOpts, levels: new Set(['E']) }, stL6);
check('inheritance follows the latest parsed header per file', stL6.matched === 2 && stL6.matches[1].lvl === 'E');

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
check('viewer surfaces themed for every non-hc preset', ['as','vscode','dracula','solarized'].every(t =>
  html.includes('data-logtheme="' + t + '"] .vbody{background:')));
check('single shared theme applier syncs both selectors', html.includes('function applyLogTheme') &&
  html.includes("$('vTheme').onchange = ()=>applyLogTheme") && html.includes("$('logThemeSel').onchange=()=>applyLogTheme"));
check('theme options present', ['Android Studio','VS Code Dark+','Dracula','Solarized Dark','High Contrast'].every(n => html.includes(n)));
check('logcat CSS attribute matches JS applier (data-logtheme)', html.includes('data-logtheme=') && html.includes("setAttribute('data-logtheme'"));
check('header buttons readable on dark bar (light text + transparent bg)', html.includes('header.top .btn.sec,body header.top .btn.sec{color:#e7edf5'));

console.log('== v1.11: viewer tab ==');
check('tabs present + persisted', html.includes('id="tabBtnWork"') && html.includes('id="tabBtnView"') && html.includes("localStorage.setItem('loglens.tab'"));
check('viewer core ids present', ['vFile','vSearch','vPrev','vNext','vMask','vTheme','vStatus','vScroll','vThumb','vBody','vFoot'].every(id => html.includes('id="'+id+'"')));
check('no separate viewer demo button (header one is shared)', !html.includes('id="vDemo"') && !html.includes('id="piiDemo"'));
check('header demo is tab-aware (viewer + pii)', html.includes('function loadDemoFile()') && html.includes("$('btnDemo').onclick") && html.includes("tabView').style.display !== 'none'") && html.includes("tabPii').style.display !== 'none'"));
check('viewer rail/body wrapped in .vmain flex row', html.includes('<div class="vmain">'));
check('viewer default theme is High Contrast', /<option value="hc">High Contrast<\/option>/.test(html));
check('viewer keyboard wiring', html.includes("e.key==='PageDown'") && html.includes("e.key==='/'"));
check('viewer arrow match-walking + mfocus', html.includes("e.key==='ArrowRight' && $('vBody').querySelector('[data-hit=\"1\"]')") && html.includes("vWalkMark(e.key==='ArrowRight' ? 1 : -1)") && html.includes("classList.add('mfocus')"));
check('viewer search spans every column', html.includes("row.querySelectorAll('td')") && html.includes("querySelector('.runcount')"));
check('ai test falls back to a chat probe when /models is missing', html.includes('models route unavailable') && html.includes('max_tokens:1'));
check('viewer anchors query real rows + chain self-heals with stack capture', html.includes("querySelectorAll('tr.vrow')") && html.includes('function vStateSane') && html.includes('loglens.lastReadErr'));
check('viewer level filter: chips render per available level, render-time skip, scan-aware search', html.includes('id="vLvls"') && html.includes('function vRenderLvlChips') && html.includes('const scanFilter = vLvlActive()') && html.includes('loglens.vlvls'));
check('hidden viewer never chains; tab switch preserves scroll', html.includes('zero geometry, never chain') && html.includes('V.viewScroll = vb.scrollTop'));
check('viewer search: byte-accurate rewrite, clean no-match (continue-cursor removed)', html.includes('vHighlightAndFocus') && html.includes('lineStartByte') && html.includes('no matches for') && !html.includes('press Enter to continue from'));
const verHdr = (html.match(/<span class="ver">(v[\d.]+)<\/span>/) || [])[1];
const verFtr = (html.match(/LogLens (v[\d.]+) ·/g) || []).pop().match(/v[\d.]+/)[0];
check('header and footer versions match (' + verHdr + ')', verHdr === verFtr);
// windowFromBuffer — forward
const wf = CORE.windowFromBuffer('l1\nl2\nl3\nl4\npar', 'forward', 3);
check('forward: maxLines complete lines', JSON.stringify(wf.lines) === JSON.stringify(['l1','l2','l3']));
check('forward: partial tail kept as residue', wf.residue === 'l4\npar');
const wf2 = CORE.windowFromBuffer('only', 'forward', 5);
check('forward: single partial, no lines', wf2.lines.length === 0 && wf2.residue === 'only');
const wf3 = CORE.windowFromBuffer('a\nb', 'forward', 5);
check('forward: tail without newline is residue (viewer appends at EOF)', JSON.stringify(wf3.lines) === JSON.stringify(['a']) && wf3.residue === 'b');
// windowFromBuffer — backward
const wb = CORE.windowFromBuffer('partial-head\nl1\nl2\nl3\n', 'backward', 2);
check('backward: last N complete lines', JSON.stringify(wb) === JSON.stringify(['l2','l3']));
const wb2 = CORE.windowFromBuffer('only-line', 'backward', 3);
check('backward: whole buffer when few lines', JSON.stringify(wb2) === JSON.stringify(['only-line']));
const wb3 = CORE.windowFromBuffer('x\ny\n', 'backward', 5);
check('backward: no trailing-newline ghost line', JSON.stringify(wb3) === JSON.stringify(['x','y']));
// estimateLineCount
check('estimate from sample', CORE.estimateLineCount('a'.repeat(50)+'\n'.repeat(10), 1000) >= 10);
check('estimate fallback for empty sample', CORE.estimateLineCount('', 8000) === 100);

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
// worker scan driver must scan per-minute like the in-page loop — without
// bucketMin the worker produces "HH:NaN" bucket keys (v1.18.10 regression)
check('worker scan driver sets bucketMin (NaN bucket guard)',
  html.includes('hardCap: msg.hardCap, bucketMin: 1, onMatch: null'));

console.log('== v1.13: GNSS coordinates ==');
check('GNSS in DEFAULT_MASK', CORE.DEFAULT_MASK.some(r => r.name === 'GNSS coordinates'));
check('GNSS detector in catalog', CORE.PII_DETECTORS.some(d => d.name === 'GNSS coordinates'));
const gnssLine = '08-24 17:45:12.000   900  2100 I GNSS: fix 48.858400, 2.294500 sats=9';
const gnssMask = CORE.compile(CORE.DEFAULT_MASK.filter(r => r.name === 'GNSS coordinates'), 'mask');
const gnssOut = CORE.maskLine('GNSS fix 48.858400, 2.294500 ok', gnssMask).line;
check('mask rule masks pair', gnssOut === 'GNSS fix [coords] ok');
check('GNSS detected in scan', CORE.scanLinePII(gnssLine, dets).some(x => x.name === 'GNSS coordinates'));
check('GNSS hemisphere + ISO form detected', (() => {
  const l = '2026-08-24T17:46:00.000Z gnssd: position 48.858412°N, 2.294511°E sats=11';
  return CORE.scanLinePII(l, dets).some(x => x.name === 'GNSS coordinates');
})());
check('GNSS space-separated detected', CORE.scanLinePII('GNSS: position 48.858400 2.294500', dets).some(x => x.name === 'GNSS coordinates'));
check('plain decimals without pair not flagged', CORE.scanLinePII('ratio 48.858400 measured', dets).every(x => x.name !== 'GNSS coordinates'));

console.log('== v1.19: multi-file search tab ==');
check('search tab markup + wiring', html.includes('id="tabBtnSearch"') && html.includes('id="tabSearch"') &&
  html.includes("search:['tabSearch','tabBtnSearch']") && html.includes("t==='view'||t==='search'||t==='pii'"));
check('worker driver handles search messages', html.includes("type:'search'") && html.includes('driveSearch') && html.includes("type:'searchDone'"));
check('search ui ids present', ['msq','msCase','msCap','msRun','msStop','msFilter','msTable','msMore','msCsv','msCopy','msSummary','msNote'].every(id => html.includes('id="' + id + '"')));

console.log('== v1.21: deep scan (presidio / LLM residual audit) ==');
check('deep scan markup + ids present',
  ['dsCfg','dsEngine','dsUrl','dsSample','dsAllow','dsRun','dsStop','dsStatus','dsProg','dsProgBar','dsFindings','dsActs','dsApply','dsDl','dsToAi','dsTarget','dsAiJump']
    .every(id => html.includes('id="' + id + '"')));
check('worker driver handles deep messages',
  html.includes("type:'deep'") && html.includes('driveDeep') && html.includes("type:'deepDone'") && html.includes("type:'deepProg'"));
check('deep system prompt asks for the findings schema',
  CORE.DEEP_SYSTEM_PROMPT.includes('"findings"') && CORE.DEEP_SYSTEM_PROMPT.includes('suggestedPattern') &&
  CORE.DEEP_SYSTEM_PROMPT.includes('ALREADY been masked'));
check('consent gate present as checkbox',
  html.includes('id="dsAllow"') && /<input type="checkbox" id="dsAllow">/.test(html));
{
  const ok = CORE.parseDeepFindings('{"findings":[{"type":"person name","description":"free text","examples":["Alice Smith"],"suggestedPattern":"\\\\b[A-Z][a-z]+ [A-Z][a-z]+\\\\b","suggestedReplace":"[name]"}]}');
  check('deep: plain JSON parses', ok.findings.length === 1 && ok.errors.length === 0 && ok.findings[0].type === 'person name');
  const fenced = CORE.parseDeepFindings('```json\n{"findings":[{"type":"t1","examples":["x"],"suggestedPattern":"("}]}\n```');
  check('deep: fenced JSON + bad regex → report-only with error', fenced.findings.length === 1 && fenced.findings[0].pattern === '' && fenced.errors.length === 1);
  check('deep: replace defaults to [redacted]', CORE.parseDeepFindings('{"findings":[{"type":"t2","examples":["y"]}]}').findings[0].replace === '[redacted]');
  const dup = CORE.parseDeepFindings('{"findings":[{"type":"t","examples":["a"]},{"type":"t","examples":["b"]}]}');
  check('deep: duplicate types merge examples + counts', dup.findings.length === 1 && dup.findings[0].examples.join(',') === 'a,b' && dup.findings[0].count === 2);
  check('deep: examples are capped (≤5, ≤120 chars)', (() => {
    const many = Array.from({length:9}, (_,i)=>'x'.repeat(200)+i);
    const r = CORE.parseDeepFindings(JSON.stringify({findings:[{type:'t',examples:many}]}));
    return r.findings[0].examples.length === 5 && r.findings[0].examples.every(x=>x.length<=120);
  })());
  check('deep: no findings array → error', CORE.parseDeepFindings('{"nope":1}').errors.length === 1);
  check('deep: prose-only garbage → error, no crash', CORE.parseDeepFindings('utter nonsense').errors.length === 1);
  check('deep: missing type rejected', CORE.parseDeepFindings('{"findings":[{"examples":["x"]}]}').errors.length === 1);
}
{
  const lines = ['aaaa', 'bob@example.com signed in', 'x'];
  const f = CORE.presidioToFindings([{start:5, end:20, entity_type:'EMAIL_ADDRESS', score:0.99}], lines);
  check('deep: presidio offsets map back to the right line', f.length === 1 && f[0].type === 'EMAIL_ADDRESS' &&
    f[0].examples[0] === 'bob@example.com' && f[0].count === 1 && f[0].description.includes('0.99'));
  check('deep: structured presidio type gets a pattern; PERSON stays report-only',
    !!f[0].pattern && CORE.presidioToFindings([{start:6, end:8, entity_type:'PERSON', score:0.8}], lines)[0].pattern === '');
  {
    const iviLine = 'YV4AB9CD12EF34567 bt=00:11:22:33:44:55';
    const ivi = CORE.presidioToFindings([
      {start:0, end:17, entity_type:'VIN', score:0.9},
      {start:21, end:38, entity_type:'MAC_ADDRESS', score:0.8},
      {start:22, end:26, entity_type:'PERSON', score:0.7},
    ], [iviLine]);
    const by = Object.fromEntries(ivi.map(x=>[x.type, x]));
    check('deep: IVI entity types (VIN, MAC_ADDRESS) map to one-click patterns',
      ivi.length === 3 && by.VIN.pattern.includes('[A-HJ-NPR-Z0-9]{17}') && by.MAC_ADDRESS.pattern.includes('{5}'));
    check('deep: PERSON from the tuned bridge stays report-only', by.PERSON.pattern === '');
  }
}

(async () => {
  if (typeof global.File === 'undefined') global.File = class extends Blob { constructor(parts, name){ super(parts); this.name = name; } };
  global.CORE = CORE;
  const drvSrc = /function WORKER_DRIVER\(self\)\{[\s\S]*?\n\}/.exec(html)[0];
  function makeSelf(){
    const msgs = [];
    const self = { postMessage: m => msgs.push(m), __abort: false };
    new Function('self', drvSrc + '\nWORKER_DRIVER(self);')(self);   // declare + install self.onmessage
    return { self, msgs };
  }
  const waitDone = async (msgs, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms){
      const d = msgs.find(m => m.type === 'searchDone');
      if (d) return d;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error('searchDone timeout');
  };
  const waitMsg = async (msgs, type, ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms){
      const d = msgs.find(m => m.type === type);
      if (d) return d;
      await new Promise(r => setTimeout(r, 10));
    }
    throw new Error(type + ' timeout');
  };
  const mkFile = (txt, name) => new File([txt], name, { type: 'text/plain' });
  const f1 = mkFile('08-24 10:00:00.000  1  1 I TagA: alpha NEEDLE one\n08-24 10:00:01.000  1  1 I TagA: beta\n', 'a.log');
  const f2 = mkFile('08-24 11:00:00.000  2  2 W TagB: gamma NEEDLE two\nno match here\n08-24 11:00:02.000  2  2 E TagB: NEEDLE three\n', 'b.log');
  const q = cap => ({ type: 'search', files: [f1, f2], names: ['a.log', 'b.log'], pattern: 'NEEDLE', flags: 'i', cap, tsFamily: null });

  { // full search across both files
    const { self, msgs } = makeSelf();
    self.onmessage({ data: q(100) });
    const done = await waitDone(msgs, 5000);
    check('search: totals across both files', done.total === 3);
    check('search: per-file counts (a=1, b=2)', done.perFile[0].matches === 1 && done.perFile[1].matches === 2);
    check('search: rows store file index, line, ts', done.matches.length === 3 &&
      done.matches[0].f === 0 && done.matches[0].ln === 1 && done.matches[0].ts === '08-24 10:00:00.000' && done.matches[1].f === 1);
    check('search: byte offsets are line starts', done.matches.every(m => typeof m.b === 'number') && done.matches[0].b === 0);
    check('search: messages clean', msgs.every(m => m.type !== 'error'));
  }
  { // global cap + per-file fair share + exact counts past the cap
    const { self, msgs } = makeSelf();
    self.onmessage({ data: q(2) });
    const done = await waitDone(msgs, 5000);
    check('search: global cap bounds storage', done.matches.length === 2);
    check('search: counts stay exact past the cap', done.total === 3 && done.perFile[1].matches === 2);
    check('search: per-file fair share flags truncation', done.perFile.some(p => p.truncated));
  }
  { // case sensitivity
    const { self, msgs } = makeSelf();
    self.onmessage({ data: { ...q(100), pattern: 'needle', flags: '' } });
    const done = await waitDone(msgs, 5000);
    check('search: case-sensitive mode works', done.total === 0);
  }
  { // stored rows keep the RAW line — masking happens at display time (mask toggle)
    const { self, msgs } = makeSelf();
    self.onmessage({ data: q(100) });
    const done = await waitDone(msgs, 5000);
    check('search: stored rows keep raw text (mask at display)', done.matches.length === 3 && done.matches.every(m => m.t.includes('NEEDLE')));
  }
  { // abort mid-scan (chunked stream gives the abort a boundary to land on —
    // Node's File stream hands out one giant chunk, unlike browser readers)
    const big = Array.from({ length: 20000 }, (_, i) => '08-24 12:00:00.000  1  1 I T: line ' + i + ' NEEDLE').join('\n') + '\n';
    const enc = new TextEncoder();
    const chunked = { name: 'big.log', size: big.length, stream(){ let off = 0; return new ReadableStream({
        async pull(ctrl){
          if (off >= big.length){ ctrl.close(); return; }
          const nl = big.indexOf('\n', off + 6000);
          const end = nl < 0 ? big.length : nl + 1;
          ctrl.enqueue(enc.encode(big.slice(off, end)));
          off = end;
          await new Promise(r => setTimeout(r, 2));
        } }); } };
    const { self, msgs } = makeSelf();
    self.onmessage({ data: { type: 'search', files: [chunked], names: ['big.log'], pattern: 'NEEDLE', flags: 'i', cap: 100000, tsFamily: null } });
    self.onmessage({ data: { type: 'abort' } });
    const done = await waitDone(msgs, 10000);
    check('search: abort stops the scan early', done.stopped === true && done.total < 20000);
  }

  // ---------- v1.21: deep-scan sampling driver ----------
  const maskRules = [{ name:'m1', pattern:'SECRET\\d+', replace:'[S]', flags:'g', enabled:true }];
  {
    const { self, msgs } = makeSelf();
    const lines = [];
    for (let i = 0; i < 50; i++) lines.push('08-24 10:00:00.000  1  1 I T: normal line SECRET' + i + ' alpha' + i);
    for (let i = 0; i < 5; i++)  lines.push('08-24 10:01:00.000  1  1 E T: error line SECRET' + i + ' boom');
    const f = mkFile(lines.join('\n') + '\n', 'deep.log');
    self.onmessage({ data: { type:'deep', files:[f], names:['deep.log'], sample:20, maskRules, errish:'', tsFamily:null } });
    const done = await waitMsg(msgs, 'deepDone', 5000);
    check('deep: sample respects the cap (5 hot + 15 reservoir)', done.sample.length === 20);
    check('deep: error lines take priority (all 5 E-lines present)', done.sample.filter(r => r.text.includes('error line')).length === 5);
    check('deep: sample lines are MASKED before leaving', done.sample.every(r => !/SECRET\d+/.test(r.text) && r.text.includes('[S]')));
    check('deep: scannedLines counts every line', done.scannedLines === 55);
    check('deep: no driver errors', msgs.every(m => m.type !== 'error'));
  }
  { // abort mid-sample (chunked stream gives the abort a boundary to land on)
    const big = Array.from({ length: 20000 }, (_, i) => '08-24 12:00:00.000  1  1 I T: line ' + i + ' SECRET' + i).join('\n') + '\n';
    const enc = new TextEncoder();
    const chunked = { name: 'big.log', size: big.length, stream(){ let off = 0; return new ReadableStream({
        async pull(ctrl){
          if (off >= big.length){ ctrl.close(); return; }
          const nl = big.indexOf('\n', off + 6000);
          const end = nl < 0 ? big.length : nl + 1;
          ctrl.enqueue(enc.encode(big.slice(off, end)));
          off = end;
          await new Promise(r => setTimeout(r, 2));
        } }); } };
    const { self, msgs } = makeSelf();
    self.onmessage({ data: { type:'deep', files:[chunked], names:['big.log'], sample:100, maskRules:[], errish:'', tsFamily:null } });
    self.onmessage({ data: { type:'abort' } });
    const done = await waitMsg(msgs, 'deepDone', 10000);
    check('deep: abort stops sampling early', done.stopped === true && done.scannedLines < 20000);
  }
  { // v1.21.1: final line without a trailing newline must still be sampled
    const { self, msgs } = makeSelf();
    const f = mkFile('08-24 10:00:00.000  1  1 I T: one SECRET1\n08-24 10:00:01.000  1  1 I T: last SECRET2', 'tail.log');
    self.onmessage({ data: { type:'deep', files:[f], names:['tail.log'], sample:100, maskRules, errish:'', tsFamily:null } });
    const done = await waitMsg(msgs, 'deepDone', 5000);
    check('deep: final line without a trailing newline still sampled',
      done.scannedLines === 2 && done.sample.some(r => r.text.includes('last') && r.text.includes('[S]')));
  }
  { // v1.21.1: pii driver — same tail guarantee
    const { self, msgs } = makeSelf();
    const f = mkFile('08-24 10:00:00.000  1  1 I T: clean line\nsomeone@example.com wrote last', 'tail2.log');
    self.onmessage({ data: { type:'pii', files:[f], names:['tail2.log'],
      detectors: CORE.PII_DETECTORS.filter(d=>d.enabled).map(d=>d.name) } });
    const done = await waitMsg(msgs, 'piiDone', 5000);
    check('pii: final line without a trailing newline still scanned',
      done.scannedLines === 2 && done.detectors.some(d => d.name === 'email'));
  }

  console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SEARCH HARNESS ERROR:', e); process.exit(2); });
