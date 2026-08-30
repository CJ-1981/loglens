/* Node smoke test for loglens.html CORE — v1.5 spec additions (no DOM).
 *
 * TARGETS THE CORE v1.5 SPEC (trunk implementation may still be in flight —
 * these tests MAY FAIL until the trunk merge lands; until then validate
 * syntax only:  node --check test_loglens_v15.js):
 *   1. maskLine single-pass, $N/$$ replacement semantics, per-rule hit counts
 *   2. time filters via prefix slice compare (boundary-minute fix)
 *   3. configurable opts.errishRe + CORE.DEFAULT_ERRISH_SOURCE
 *   4. grep-style context lines (-A/-B) with dedup, masking, hardCap,
 *      onMatch ctx kinds, no cross-file bleed
 *   5. per-file stats (state.byFile)
 *   6. CORE.pickBucketSize boundaries
 *   7. CORE.mergeBuckets semantics
 *   8. legacy surface still intact (light smoke only — full legacy coverage
 *      lives in test_loglens.js and is NOT duplicated here)
 */
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

// ---- shared helpers ----------------------------------------------------
const ALL_LEVELS = new Set(['V', 'D', 'I', 'W', 'E', 'F']);
// compiled mask rule shape per v1.5 spec: {name, rx (RegExp with 'g'), replace}
// Resolved from the spec example: the stated output 'vin=YV4**********4567'
// implies group1 = 'YV' + 1 char, 10 chars masked, group2 = last 4 chars
// (the literal spec regex with {10} inside group 1 cannot produce that output;
// it is tested separately below).
const MASKS = [{ name: 'VIN', rx: /(YV[A-HJ-NPR-Z0-9])[A-HJ-NPR-Z0-9]{10}([A-HJ-NPR-Z0-9]{4})/g, replace: '$1**********$2' }];
function baseOpts(over) {
  return Object.assign({
    include: [{ name: 'inc', rx: /HIT/ }],
    exclude: [],
    levels: ALL_LEVELS,
    fromTs: null, toTs: null,
    applyMask: false, maskCompiled: MASKS,
    hardCap: 100000, bucketMin: 1,
    context: 0
  }, over || {});
}
function ln(ts, lvl, tag, msg) { return ts + '  100  200 ' + lvl + ' ' + tag + ': ' + msg; }

console.log('== 1. maskLine single-pass ==');
const vin1 = CORE.maskLine('vin=YV4AB9CD12EF34567', MASKS);
check('vin: $1/$2 replacement string', vin1.line === 'vin=YV4**********4567');
check('vin: hits = 1', vin1.hits['VIN'] === 1);
// literal spec regex variant ($1 = YV + 10 chars, $2 = next 4, trailing char kept)
const litRules = [{ name: 'V', rx: /(YV[A-HJ-NPR-Z0-9]{10})([A-HJ-NPR-Z0-9]{4})/g, replace: '$1**********$2' }];
const vin2 = CORE.maskLine('vin=YV4AB9CD12EF34567', litRules);
check('literal spec rx: $1/$2 substituted in one pass', vin2.line === 'vin=YV4AB9CD12EF**********34567');
check('literal spec rx: hits = 1', vin2.hits['V'] === 1);
const vin3 = CORE.maskLine('a YV4AB9CD12EF34567 b YV4ZZ99ZZ88777777 c', MASKS);
check('two tokens one rule: hits = 2', vin3.hits['VIN'] === 2);
check('two tokens one rule: both masked', vin3.line === 'a YV4**********4567 b YV4**********7777 c');
check('$$ -> literal $', CORE.maskLine('ab', [{ name: 'd', rx: /(a)(b)/g, replace: '$1 $$ $2' }]).line === 'a $ b');
const og = [{ name: 'o', rx: /(a)|(b)/g, replace: '[$1$2]' }];
check('missing optional group -> empty (ab)', CORE.maskLine('ab', og).line === '[a][b]');
check('missing optional group -> empty (b)', CORE.maskLine('b', og).line === '[b]');
const chain = CORE.maskLine('foo foo', [
  { name: 'r1', rx: /foo/g, replace: 'bar' },
  { name: 'r2', rx: /bar/g, replace: 'baz' }
]);
check('rules applied in order (chained)', chain.line === 'baz baz');
check('hits counted per rule', chain.hits['r1'] === 2 && chain.hits['r2'] === 2);
const clean = CORE.maskLine('nothing to see', MASKS);
check('no-hit line unchanged, empty hits', clean.line === 'nothing to see' && Object.keys(clean.hits).length === 0);
const ru = [{ name: 'r', rx: /ab/g, replace: 'X' }];
const ruA = CORE.maskLine('abab', ru), ruB = CORE.maskLine('abab', ru);
check('compiled rules reusable (no lastIndex bleed)', ruA.line === 'XX' && ruB.line === 'XX' && ruA.hits['r'] === 2 && ruB.hits['r'] === 2);

console.log('== 2. time filters: prefix slice compare ==');
const tfText = [
  '08-24 19:20:00.000  1  1 I T: x',
  '08-24 19:21:00.000  1  1 I T: x',
  '08-24 19:22:59.999  1  1 I T: x',
  '08-24 19:23:00.000  1  1 I T: x',
  '08-24 19:25:00.000  1  1 I T: x'
].join('\n');
function tfRun(over, text) {
  const st = CORE.newState();
  CORE.processText(text || tfText, 'f.log', baseOpts(Object.assign({ include: [{ name: 'i', rx: /x/ }] }, over)), st);
  return st.matched;
}
check('toTs boundary: 19:22:59.999 included', tfRun({ toTs: '08-24 19:22' }, '08-24 19:22:59.999  1  1 I T: x') === 1);
check('toTs boundary: 19:23:00.000 excluded', tfRun({ toTs: '08-24 19:22' }, '08-24 19:23:00.000  1  1 I T: x') === 0);
check('fromTs boundary: 15:37:00.000 included', tfRun({ fromTs: '08-24 15:37' }, '08-24 15:37:00.000  1  1 I T: x') === 1);
check('fromTs boundary: 15:36:59.999 excluded', tfRun({ fromTs: '08-24 15:37' }, '08-24 15:36:59.999  1  1 I T: x') === 0);
check('window from 19:21 to 19:22 keeps both boundary minutes', tfRun({ fromTs: '08-24 19:21', toTs: '08-24 19:22' }) === 2);
check('no filters: all 5 lines match', tfRun({}) === 5);
check('lines without parseable ts bypass time filters', tfRun({ fromTs: '08-24 19:21', toTs: '08-24 19:22' },
  ['08-24 19:21:30.000  1  1 I T: x', 'E/Leg(9): x', 'plain text x line'].join('\n')) === 3);

console.log('== 3. configurable errish regex ==');
check('DEFAULT_ERRISH_SOURCE is non-empty string', typeof CORE.DEFAULT_ERRISH_SOURCE === 'string' && CORE.DEFAULT_ERRISH_SOURCE.length > 0);
check('DEFAULT_ERRISH_SOURCE matches FATAL EXCEPTION', new RegExp(CORE.DEFAULT_ERRISH_SOURCE, 'i').test('FATAL EXCEPTION') === true);
check('DEFAULT_ERRISH_SOURCE rejects clean text', new RegExp(CORE.DEFAULT_ERRISH_SOURCE, 'i').test('all good here') === false);
const kwOnly = '08-24 12:00:01.000  1  1 I T: error keyword here';
function errRun(lines, over) {
  const st = CORE.newState();
  CORE.processText(lines, 'e.log', baseOpts(Object.assign({ include: [{ name: 'i', rx: /./ }] }, over)), st);
  return st;
}
check('built-in keyword regex applies when errishRe absent', errRun(kwOnly, {}).errish === 1);
check('errishRe replaces keyword regex (I-level keyword ignored)', errRun(kwOnly, { errishRe: /NEEDLE/ }).errish === 0);
const mixed = [
  '08-24 12:00:01.000  1  1 I T: error keyword here',
  '08-24 12:00:02.000  1  1 I T: NEEDLE found',
  '08-24 12:00:03.000  1  1 W T: warning text',
  '08-24 12:00:04.000  1  1 E T: plain boom'
].join('\n');
const stE = errRun(mixed, { errishRe: /NEEDLE/ });
check('errishRe hit + E/W levels still errish', stE.matched === 4 && stE.errish === 3);

console.log('== 4. context lines (-A/-B) ==');
const BLOCK = [
  ln('08-24 09:00:00.000', 'I', 'Alpha', 'pre1'),
  ln('08-24 09:00:01.000', 'I', 'Alpha', 'pre2'),
  ln('08-24 09:00:02.000', 'I', 'Alpha', 'pre3'),
  ln('08-24 09:00:03.000', 'I', 'Alpha', 'HIT one'),
  ln('08-24 09:00:04.000', 'I', 'Alpha', 'post1 vin=YV4AB9CD12EF34567'),
  ln('08-24 09:00:05.000', 'I', 'Alpha', 'post2'),
  ln('08-24 09:00:06.000', 'I', 'Alpha', 'tail1'),
  ln('08-24 09:00:07.000', 'I', 'Alpha', 'tail2')
].join('\n');
function ctxRun(text, over) {
  const st = CORE.newState();
  const seen = [];
  const opts = baseOpts(Object.assign({
    applyMask: true,
    onMatch: r => seen.push({ lineno: r.lineno, ctx: r.ctx, masked: r.masked, file: r.file })
  }, over));
  CORE.processText(text, 'c.log', opts, st);
  return { st, seen };
}
// 8-line block, match on line 4, context=2 -> lines 2,3 before + 4 match + 5,6 after
const R1 = ctxRun(BLOCK, { context: 2 });
check('ctx order: before/before/match/after/after', JSON.stringify(R1.seen.map(s => s.ctx)) === '["before","before","match","after","after"]');
check('ctx linenos are 2..6', JSON.stringify(R1.seen.map(s => s.lineno)) === '[2,3,4,5,6]');
check('matched = 1 (context not counted)', R1.st.matched === 1);
check('ctxCount = 4', R1.st.ctxCount === 4);
check('exactly 5 records emitted', R1.seen.length === 5);
check('byFile.lines counts every line (8)', !!R1.st.byFile['c.log'] && R1.st.byFile['c.log'].lines === 8);
check('byLevel counts match only', R1.st.byLevel['I'] === 1);
check('byTag counts match only', R1.st.byTag['Alpha'] === 1);
const bSum = Object.keys(R1.st.buckets).reduce((a, k) => a + R1.st.buckets[k], 0);
check('buckets count match only', bSum === 1);
check('context lines not errish-counted', R1.st.errish === 0);
const after5 = R1.seen.find(s => s.lineno === 5);
check('after-context line is masked (VIN)', !!after5 && after5.masked.indexOf('YV4**********4567') >= 0);
check('no raw VIN in any emitted record', R1.seen.every(s => s.masked.indexOf('YV4AB9CD12EF34567') < 0));
const mm1 = R1.seen.find(s => s.ctx === 'match');
check('match record carries file/lineno', !!mm1 && mm1.file === 'c.log' && mm1.lineno === 4);
check('context records stored in state.matches', R1.st.matches.length === 5);
check('stored records carry valid .ctx', R1.st.matches.every(r => r.ctx === 'match' || r.ctx === 'before' || r.ctx === 'after'));
check('not truncated with large hardCap', R1.st.truncated === false);

// adjacent matches 1 line apart with context=2 -> shared middle line deduped
const ADJ = [
  ln('08-24 10:00:00.000', 'I', 'Beta', 'head'),
  ln('08-24 10:00:01.000', 'I', 'Beta', 'HIT a'),
  ln('08-24 10:00:02.000', 'I', 'Beta', 'mid'),
  ln('08-24 10:00:03.000', 'I', 'Beta', 'HIT b'),
  ln('08-24 10:00:04.000', 'I', 'Beta', 'tail')
].join('\n');
const R2 = ctxRun(ADJ, { context: 2 });
check('adjacent matches: all 5 lines emitted', R2.seen.length === 5);
check('adjacent matches: linenos unique and in order', JSON.stringify(R2.seen.map(s => s.lineno)) === '[1,2,3,4,5]');
check('adjacent matches: matched = 2', R2.st.matched === 2);
check('adjacent matches: ctxCount = 3 (shared line deduped)', R2.st.ctxCount === 3);
check('adjacent matches: two match records', R2.seen.filter(s => s.ctx === 'match').length === 2);

// hardCap applies to the matches array regardless of record kind
const R3 = ctxRun(ADJ, { context: 2, hardCap: 3 });
check('hardCap=3: matches.length <= 3', R3.st.matches.length === 3);
check('hardCap=3 exceeded: truncated = true', R3.st.truncated === true);

// context must not cross file boundaries (processText, shared state)
const F1 = [ln('08-24 11:00:00.000', 'I', 'Gamma', 'tail1'), ln('08-24 11:00:01.000', 'I', 'Gamma', 'tail2')].join('\n');
const F2 = [ln('08-24 11:00:02.000', 'I', 'Gamma', 'HIT start'), ln('08-24 11:00:03.000', 'I', 'Gamma', 'after1'), ln('08-24 11:00:04.000', 'I', 'Gamma', 'after2')].join('\n');
const stF = CORE.newState();
const seenF = [];
CORE.processText(F1, 'f1.log', baseOpts({ context: 2, onMatch: r => seenF.push(r) }), stF);
CORE.processText(F2, 'f2.log', baseOpts({ context: 2, onMatch: r => seenF.push(r) }), stF);
check('file boundary: no before-context from file 1', seenF.every(r => r.file !== 'f1.log'));
check('file boundary: match + 2 after only', JSON.stringify(seenF.map(r => r.ctx)) === '["match","after","after"]');
check('file boundary: matched = 1', stF.matched === 1);
check('file boundary: ctxCount = 2', stF.ctxCount === 2);

// context must not cross file boundaries (sequential processLine, different file arg)
const stP = CORE.newState();
let pSeen = 0;
const oP = baseOpts({ context: 2, onMatch: () => pSeen++ });
CORE.processLine(ln('08-24 12:00:00.000', 'I', 'Delta', 'tail1'), 1, 'g1', stP, oP);
CORE.processLine(ln('08-24 12:00:01.000', 'I', 'Delta', 'tail2'), 2, 'g1', stP, oP);
CORE.processLine(ln('08-24 12:00:02.000', 'I', 'Delta', 'HIT start'), 1, 'g2', stP, oP);
check('processLine: match at start of new file emits no file-1 context', pSeen === 1 && stP.matched === 1);
check('processLine: no context counted across file switch', stP.ctxCount === 0);

// context=0 (and absent) -> exactly old behavior
const R4 = ctxRun(BLOCK, { context: 0 });
check('context=0: only the match emitted', R4.seen.length === 1 && R4.seen[0].lineno === 4);
check('context=0: matched = 1 and ctxCount = 0', R4.st.matched === 1 && R4.st.ctxCount === 0);

console.log('== 5. per-file stats ==');
const stM = CORE.newState();
const incHit = [{ name: 'i', rx: /HIT/ }];
CORE.processText([
  '08-24 10:00:00.000  1  1 I TagA: alpha',
  '08-24 11:00:00.000  1  1 E TagA: HIT one',
  '08-24 12:00:00.000  1  1 I TagA: gamma'
].join('\n'), 'a.log', baseOpts({ include: incHit }), stM);
CORE.processText([
  '08-24 13:00:00.000  2  2 W TagB: HIT two',
  '08-24 14:00:00.000  2  2 I TagB: delta'
].join('\n'), 'b.log', baseOpts({ include: incHit }), stM);
check('byFile a.log: every line counted (3)', !!stM.byFile['a.log'] && stM.byFile['a.log'].lines === 3);
check('byFile a.log: matched/errish match-only', stM.byFile['a.log'].matched === 1 && stM.byFile['a.log'].errish === 1);
check('byFile a.log: firstTs/lastTs from any line (incl. non-match)', stM.byFile['a.log'].firstTs === '08-24 10:00:00.000' && stM.byFile['a.log'].lastTs === '08-24 12:00:00.000');
check('byFile b.log: lines + matched/errish', stM.byFile['b.log'].lines === 2 && stM.byFile['b.log'].matched === 1 && stM.byFile['b.log'].errish === 1);
check('byFile b.log: firstTs/lastTs', stM.byFile['b.log'].firstTs === '08-24 13:00:00.000' && stM.byFile['b.log'].lastTs === '08-24 14:00:00.000');
check('shared state totals across both files', stM.matched === 2 && stM.total === 5);

console.log('== 6. pickBucketSize boundaries ==');
const PB = [[24, 1], [25, 5], [48, 5], [49, 10], [120, 10], [121, 30], [288, 30], [289, 60], [672, 60], [673, 360]];
for (const [n, want] of PB) check('pickBucketSize(' + n + ') = ' + want, CORE.pickBucketSize(n) === want);

console.log('== 7. mergeBuckets ==');
const src = { '08-24 12:03': 2, '08-24 12:07': 1, '08-24 12:58': 4 };
const m5 = CORE.mergeBuckets(src, 5);
check('merge 5min floors', m5['08-24 12:00'] === 2 && m5['08-24 12:05'] === 1 && m5['08-24 12:55'] === 4);
check('merge 5min: totals preserved', Object.keys(m5).reduce((a, k) => a + m5[k], 0) === 7);
check('merge 5min: no stray keys', Object.keys(m5).length === 3);
const m1 = CORE.mergeBuckets(src, 1);
check('merge 1min is identity', m1['08-24 12:03'] === 2 && m1['08-24 12:07'] === 1 && Object.keys(m1).length === 3);

console.log('== 8. legacy surface still intact ==');
const st0 = CORE.newState();
check('newState: ctxCount/truncated added', st0.ctxCount === 0 && st0.truncated === false);
check('newState: byFile starts empty', !!st0.byFile && typeof st0.byFile === 'object' && Object.keys(st0.byFile).length === 0);
check('newState: legacy fields intact', st0.total === 0 && st0.matched === 0 && st0.errish === 0 && Array.isArray(st0.matches));
check('DEFAULT_MASK 16 generic rules', Array.isArray(CORE.DEFAULT_MASK) && CORE.DEFAULT_MASK.length === 16);
check('DEFAULT_EXTRACT present (empty = match all)', Array.isArray(CORE.DEFAULT_EXTRACT));
check('DEMO sample intact', typeof CORE.DEMO === 'string' && CORE.DEMO.indexOf('YV4DEM0123AB34567') >= 0);
check('SYSTEM_PROMPT mentions schema', CORE.SYSTEM_PROMPT.indexOf('"extract"') >= 0 && CORE.SYSTEM_PROMPT.indexOf('"mask"') >= 0);
check('extractJSON works', CORE.extractJSON('sure:\n{"extract":[]}\n.done') === '{"extract":[]}');
check('parseHeader works', (() => { const h = CORE.parseHeader('08-24 15:37:34.240  3807  4188 I MyApp:Sub: msg'); return !!h && h.ts === '08-24 15:37:34.240' && h.lvl === 'I' && h.tag === 'MyApp:Sub' && h.pid === '3807'; })());
check('parseHeader non-header -> null', CORE.parseHeader('random text') === null);
check('HDR regex exposed', CORE.HDR instanceof RegExp);
check('compile ok + bad regex flagged', CORE.compile([{ name: 'n', pattern: 'abc', kind: 'include', enabled: true }], 'extract').length === 1 && !!CORE.compile([{ name: 'bad', pattern: '(unclosed' }], 'mask')[0].error);
check('validateProfile(null) -> 1 error', CORE.validateProfile(null).errors.length === 1);

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
