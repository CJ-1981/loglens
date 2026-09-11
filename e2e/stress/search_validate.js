/* Multi-file search stress validation — 3 multi-GB files, every search behavior.
 * Run: node e2e/stress/search_validate.js        (~5-10 min, needs gen_fixtures first)
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BIG = process.env.STRESS_DIR || path.join(os.tmpdir(), 'loglens_stress');
const EXP = JSON.parse(fs.readFileSync(path.join(BIG, 'expectations.json'), 'utf8'));
const [FA, FB, FC] = EXP.files;
let pass = 0, fail = 0; const errors = [];
const check = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (c || !extra ? '' : ' — ' + extra)); };
const fmt = n => n.toLocaleString('en-US');
const digits = s => String(s).replace(/[^\d]/g, '');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => errors.push(String(e).slice(0, 140)));
  page.on('dialog', d => d.dismiss());
  await page.goto('file://' + path.resolve(__dirname, '..', '..', 'loglens.html'));
  await page.setInputFiles('#fpick', [
    path.join(BIG, 'stress_a.log'), path.join(BIG, 'stress_b.log'), path.join(BIG, 'stress_c.log'),
  ]);
  await page.waitForTimeout(1200);
  await page.click('#tabBtnSearch');
  await page.waitForTimeout(400);

  const runSearch = async (pattern, opts = {}) => {
    await page.fill('#msq', pattern);
    if (opts.caseSensitive !== undefined) {
      const on = await page.evaluate(() => document.getElementById('msCase').classList.contains('on'));
      if (on !== opts.caseSensitive) await page.evaluate(() => document.getElementById('msCase').click());
    }
    if (opts.cap !== undefined) await page.fill('#msCap', String(opts.cap));
    const t0 = Date.now();
    await page.click('#msRun');
    let summary = '';
    for (let i = 0; i < 200; i++) {
      await page.waitForTimeout(2000);
      summary = await page.evaluate(() => {
        const s = document.getElementById('msSummary');
        return s && s.style.display !== 'none' ? s.textContent : '';
      });
      if (/matching line/.test(summary)) break;
    }
    return { summary, wall: ((Date.now() - t0) / 1000).toFixed(0) };
  };
  const summaryParts = () => page.evaluate(() => {
    const s = document.getElementById('msSummary');
    const per = [...s.querySelectorAll('i')].length;          // 'stopped early' marker
    return { total: parseInt(s.querySelector('b').textContent.replace(/[^\d]/g, ''), 10), text: s.textContent, stopped: s.textContent.includes('stopped early') };
  });

  // ---- 1. exact totals across 5.5 GB, per-file breakdown ----
  console.log('== 1. VIN pattern: exact per-file totals across 5.5 GB ==');
  let r = await runSearch('YV4STR0SS');
  check('total is exact (' + fmt(EXP.totals.vinLines) + ')', digits(r.summary).includes(String(EXP.totals.vinLines)), r.summary.slice(0, 120));
  check('per-file A exact (' + fmt(FA.vinLines) + ')', r.summary.includes('stress_a.log: ' + fmt(FA.vinLines)), '');
  check('per-file B exact (' + fmt(FB.vinLines) + ')', r.summary.includes('stress_b.log: ' + fmt(FB.vinLines)), '');
  check('per-file C exact (' + fmt(FC.vinLines) + ')', r.summary.includes('stress_c.log: ' + fmt(FC.vinLines)), '');
  check('every file flagged (capped) under the 20k default cap', (r.summary.match(/\(capped\)/g) || []).length === 3);
  console.log('  wall: ' + r.wall + ' s');

  // ---- 2. stored-rows cap: default 20000 across 3 files (share 6666 each) ----
  console.log('== 2. stored-rows cap semantics ==');
  const shown = await page.evaluate(() => document.querySelectorAll('#msBody tr').length);
  check('first results page renders 500 rows', shown === 500, 'rows=' + shown);
  const capNote = await page.evaluate(() => document.getElementById('msNote').textContent);
  check('cap note reports the stored-row count', /capped at [\d,]+ stored rows/.test(capNote), capNote.slice(0, 90));

  // ---- 3. pattern that exists only in file A ----
  console.log('== 3. one-file pattern: RAREBEACON (20 matches, all in A) ==');
  r = await runSearch('RAREBEACON');
  check('total is 20', r.summary.includes(fmt(20) + ' matching line'), r.summary.slice(0, 120));
  check('file A breakdown exact (20)', r.summary.includes('stress_a.log: 20'), '');
  check('no truncation flags for small results', !r.summary.includes('(capped)'));
  const files = await page.evaluate(() => [...new Set([...document.querySelectorAll('#msBody tr td:first-child')].map(td => td.title))]);
  check('all rows attributed to stress_a.log', files.length === 1 && files[0] === 'stress_a.log', files.join(','));
  console.log('  wall: ' + r.wall + ' s');

  // ---- 4. zero-match pattern ----
  console.log('== 4. zero-match pattern ==');
  r = await runSearch('ZZZNOMATCHZZZ');
  check('zero matches reported cleanly', r.summary.includes('0 matching line'), r.summary.slice(0, 100));

  // ---- 5. case sensitivity toggle ----
  console.log('== 5. case-sensitive vs insensitive ==');
  r = await runSearch('stress line 000000001', { caseSensitive: true });
  check('case-sensitive finds nothing when the case differs', r.summary.includes('0 matching line'), r.summary.slice(0, 100));
  r = await runSearch('STRESS line 000000001', { caseSensitive: true });
  check('case-sensitive finds the exact-case line (1 per file = 3)', r.summary.includes('3 matching line') && r.summary.includes('stress_a.log: 1') && r.summary.includes('stress_c.log: 1'), r.summary.slice(0, 140));
  r = await runSearch('sTrEsS LiNe 000000001', { caseSensitive: false });
  check('insensitive finds it in every file (3)', r.summary.includes('3 matching line'), r.summary.slice(0, 120));

  // ---- 6. stop mid-scan, then re-run: state must fully reset ----
  console.log('== 6. stop mid-scan, then fresh re-run ==');
  await page.fill('#msq', 'YV4STR0SS');
  await page.click('#msRun');
  await page.waitForTimeout(12000);                       // let it scan part-way
  const stopDisabled = await page.evaluate(() => document.getElementById('msStop').disabled);
  if (!stopDisabled) await page.click('#msStop');
  await page.waitForTimeout(3000);
  const stoppedSummary = await page.evaluate(() => document.getElementById('msSummary').textContent);
  check('stopped search reports "stopped early"', /matching line/.test(stoppedSummary) && stoppedSummary.includes('stopped early'), stoppedSummary.slice(0, 100));
  r = await runSearch('YV4STR0SS');
  check('fresh re-run after a stop is still exact (' + fmt(EXP.totals.vinLines) + ')', digits(r.summary).includes(String(EXP.totals.vinLines)), r.summary.slice(0, 120));
  check('re-run is not marked stopped', !r.summary.includes('stopped early'));

  // ---- 7. small cap: pagination + per-file jumps across all 3 files ----
  console.log('== 7. small cap (1500): 500 rows per file, pagination + jumps ==');
  r = await runSearch('YV4STR0SS', { cap: 1500 });
  const pages = await page.evaluate(() => document.getElementById('msMore').textContent);
  check('show-more reports 1500 stored rows', pages.includes('1,500'), pages);
  // page through all 3 pages
  for (let p = 0; p < 2; p++) { await page.click('#msMore'); await page.waitForTimeout(400); }
  const allRows = await page.evaluate(() => [...document.querySelectorAll('#msBody tr')].map(tr => ({
    file: tr.querySelector('td').title,
    ln: +tr.querySelectorAll('td')[1].textContent,
  })));
  check('all 1500 stored rows render across 3 pages', allRows.length === 1500, 'rows=' + allRows.length);
  const perFile = {};
  allRows.forEach(rw => perFile[rw.file] = (perFile[rw.file] || 0) + 1);
  check('stored rows split per file (500 each under the share cap)',
    perFile['stress_a.log'] === 500 && perFile['stress_b.log'] === 500 && perFile['stress_c.log'] === 500, JSON.stringify(perFile));
  check('rows are in file order A→B→C', (() => {
    let last = '';
    for (const rw of allRows) { if (rw.file !== last) { if (last > rw.file) return false; last = rw.file; } }
    return last === 'stress_c.log';
  })());
  // jump to the first row of each file's block; viewer must open that file at that line
  for (const [idx, fname] of [[0, 'stress_a.log'], [500, 'stress_b.log'], [1000, 'stress_c.log']]) {
    await page.click('#tabBtnSearch');
    await page.waitForTimeout(300);
    await page.locator('#msBody tr').nth(idx).click();
    await page.waitForTimeout(3000);
    const ok = await page.evaluate((fn) => {
      const sel = document.getElementById('vFile');
      const m = document.querySelector('#vBody tr.mfocus');
      return sel && sel.value === fn && m && !!m.querySelector('td.ln');
    }, fname);
    check('row ' + idx + ' (' + fname + ') jumps into the right file with a focused line', ok);
  }

  // ---- 8. mask toggle changes display only ----
  console.log('== 8. mask display toggle ==');
  await page.click('#tabBtnSearch');
  await page.waitForTimeout(400);
  const head1 = await page.evaluate(() => document.getElementById('msTable').querySelector('thead').textContent);
  await page.evaluate(() => document.getElementById('msMask').click());
  await page.waitForTimeout(500);
  const head2 = await page.evaluate(() => document.getElementById('msTable').querySelector('thead').textContent);
  check('mask toggle flips the column header (masked → raw)', head1 !== head2 && head1.includes('(masked)') && head2.includes('(raw)'), head2);
  await page.evaluate(() => document.getElementById('msMask').click());

  // ---- 9. stability ----
  const heap = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
  check('JS heap bounded after 9 multi-GB searches (' + heap + ' MB < 400 MB)', heap < 400);
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await browser.close();
  console.log('\nSEARCH-VALIDATE RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
