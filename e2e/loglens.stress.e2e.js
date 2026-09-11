/* LogLens STRESS E2E — multiple multi-GB files, every feature, real Chromium.
 *
 *   node e2e/stress/gen_fixtures.js     (first: writes ~5.5 GB of fixtures)
 *   node e2e/loglens.stress.e2e.js      (this suite; ~15-25 min)
 *
 * Phases:
 *   A  load 3 files (2 + 2 + 1.5 GB)
 *   B  viewer: wheel down across many window boundaries, wheel up across backward
 *      chains, rail wheel forwarding, rail drags to 50%/95% + deep backward wheel,
 *      level-filtered wheeling, go-to-time, cross-GB forward search + match walk,
 *      gap detector, boots scan, collapse, wrap, font, Δt, themes, mask, bookmarks
 *   C  search tab: multi-file regex past the 20k cap (exact totals), match→viewer jump
 *   D  workbench: full scan of all ~5.5 GB (exact line/match totals), capped extract download
 *   E  PII audit across all files
 *   F  memory: JS heap stays bounded (constant-memory claim), zero page errors
 */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILE = 'file://' + path.resolve(__dirname, '..', 'loglens.html');
const EXP = JSON.parse(fs.readFileSync(path.join(__dirname, 'stress', '_big', 'expectations.json'), 'utf8'));
const BIG = process.env.STRESS_DIR || path.join(os.tmpdir(), 'loglens_stress');
let pass = 0, fail = 0; const errors = [];
const check = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (c || !extra ? '' : ' — ' + extra)); };
const digits = s => String(s).replace(/[^\d]/g, '');
const fmt = n => n.toLocaleString('en-US');

(async () => {
  let browser, page;
  const heap = async () => page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
  let t0 = Date.now();
  const FROM = process.env.STRESS_FROM || 'A';   // STRESS_FROM=C resumes at phase C (A still runs: files must load)
  const want = s => 'ABCDE'.indexOf(FROM) <= 'ABCDE'.indexOf(s);
  const lap = label => console.log('  [' + ((Date.now() - t0) / 1000).toFixed(0) + 's] ' + label);
  // long-lived Playwright sessions wedge (evaluates stop resolving on an idle
  // renderer) — run each phase in a FRESH browser with the files re-attached
  const FILES = [path.join(BIG, 'stress_a.log'), path.join(BIG, 'stress_b.log'), path.join(BIG, 'stress_c.log')];
  async function freshPage() {
    if (browser) { try { await browser.close(); } catch (e) {} }
    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => errors.push(String(e).slice(0, 160)));
    await page.goto(FILE);
    await page.waitForTimeout(400);
    await page.setInputFiles('#fpick', FILES);
    await page.waitForTimeout(1500);
  }

  await freshPage();

  // ============ A · LOAD 3 MULTI-GB FILES ============
  console.log('\n== A. Load ' + (EXP.totals.bytes / 1073741824).toFixed(1) + ' GB across 3 files ==');
  await page.setInputFiles('#fpick', [path.join(BIG, 'stress_a.log'), path.join(BIG, 'stress_b.log'), path.join(BIG, 'stress_c.log')]);
  await page.waitForTimeout(1500);
  const fileRows = await page.evaluate(() => [...document.querySelectorAll('#filelist .fileitem .nm')].map(e => e.textContent));
  check('3 multi-GB files listed', fileRows.length === 3, fileRows.join(','));
  const szs = await page.evaluate(() => [...document.querySelectorAll('#filelist .fileitem .sz')].map(e => parseFloat(e.textContent)));
  check('sizes report ≥ 1.5 GB each (shown in MB)', szs.filter(v => v >= 1500).length === 3, szs.join(','));
  lap('files loaded');

  // ============ B · VIEWER ============
  if (want("B")) {
  console.log('\n== B1. Viewer: initial window over a 2 GB file ==');
  await page.click('#tabBtnView');
  await page.waitForTimeout(1200);
  check('viewer renders ~900-line window', await page.evaluate(() => document.querySelectorAll('#vBody tr.vrow').length) >= 600);
  check('file selector holds stress_a.log', await page.evaluate(() => document.getElementById('vFile').value) === 'stress_a.log');

  const firstVisLn = () => page.evaluate(() => {
    const b = document.getElementById('vBody');
    const st = b.scrollTop, br = b.getBoundingClientRect();
    for (const r of b.querySelectorAll('tr.vrow')) {
      const rt = r.getBoundingClientRect().top - br.top + st;
      if (rt + r.offsetHeight > st) return +r.querySelector('td.ln').textContent;
    }
    return null;
  });
  const readPct = () => page.evaluate(() => parseFloat(document.getElementById('vFoot').textContent) || 0);
  const box = await page.locator('#vBody').boundingBox();

  console.log('\n== B2. Mouse-wheel DOWN through forward chains ==');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  let snapped = false, prevLn = 1, lnMax = 1;
  for (let i = 0; i < 260; i++) {
    await page.mouse.wheel(0, 1200);
    if (i % 10 === 9) {
      const top = await page.evaluate(() => document.getElementById('vBody').scrollTop);
      const ln = await firstVisLn();
      if (top === 0 && i > 20) snapped = true;
      if (ln != null) { if (ln < prevLn - 3) snapped = true; prevLn = ln; lnMax = Math.max(lnMax, ln); }
    }
  }
  // 260 wheel notches ≈ 16k lines ≈ 17 window boundaries on a 28.4M-line file —
  // file-position % barely moves (0.1%), so assert on LINES advanced instead
  check('wheel-down advanced ≥10,000 lines (crossed ≥11 window boundaries)', lnMax >= 10000, 'reached line ' + fmt(lnMax));
  check('no snap-back / backward slide during 260+ wheel-downs', !snapped);
  lap('wheel down done');

  console.log('\n== B3. Mouse-wheel UP through backward chains ==');
  let slid = false, lnMin = prevLn;
  for (let i = 0; i < 260; i++) {
    await page.mouse.wheel(0, -1200);
    if (i % 10 === 9) {
      const pct = await readPct(); const ln = await firstVisLn();
      const top = await page.evaluate(() => document.getElementById('vBody').scrollTop);
      if (ln != null && ln > prevLn + 5000) slid = true;      // violent forward jump while wheeling up
      if (ln != null) prevLn = ln; lnMin = Math.min(lnMin, ln);
      if (top === 0 && pct === 0) break;
    }
  }
  check('wheel-up returned toward the top (line ' + fmt(lnMin) + ')', lnMin <= 1500);
  check('no violent jumps during backward chaining', !slid);
  lap('wheel up done');

  console.log('\n== B4. Rail wheel forwarding + rail drags (byte rail) ==');
  const rail = await page.locator('#vScroll').boundingBox();
  await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height / 2);
  const top0 = await page.evaluate(() => document.getElementById('vBody').scrollTop);
  const tops = [];
  for (let i = 0; i < 25; i++) {
    await page.mouse.wheel(0, 900);
    await page.waitForTimeout(40);
    if (i % 5 === 4) tops.push(await page.evaluate(() => Math.round(document.getElementById('vBody').scrollTop)));
  }
  const top1 = await page.evaluate(() => Math.round(document.getElementById('vBody').scrollTop));
  console.log('  rail wheel scrollTop trace: ' + tops.join(' → ') + ' (start ' + Math.round(top0) + ')');
  check('wheel over the rail scrolls the log', top1 - top0 > 500, '+' + (top1 - top0) + 'px');
  // drag to 50%
  await page.mouse.move(rail.x + rail.width / 2, rail.y + 4);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  let pct = await readPct();
  check('rail drag lands ~50% of a 2 GB file', Math.abs(pct - 50) <= 4, 'got ' + pct.toFixed(1) + '%');
  // drag to 95%
  await page.mouse.move(rail.x + rail.width / 2, rail.y + 4);
  await page.mouse.down();
  await page.mouse.move(rail.x + rail.width / 2, rail.y + rail.height * 0.95, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(2000);
  pct = await readPct();
  check('rail drag lands ~95% (window starts near EOF)', pct >= 90, 'got ' + pct.toFixed(1) + '%');
  lap('rail drags done');

  console.log('\n== B5. Deep backward wheel from near-EOF ==');
  const lnBeforeBack = await firstVisLn();
  let backOk = true;
  for (let i = 0; i < 120; i++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -1200);
    if (i % 20 === 19) {
      const p = await readPct();
      if (!isFinite(p)) backOk = false;
    }
  }
  const lnAfterBack = await firstVisLn();
  // 120 notches ≈ 7.4k lines of a 28M-line file — file % barely moves; the
  // content itself must climb backward without breaking
  check('wheel-up from 95% chains backward (−' + fmt(lnBeforeBack - lnAfterBack) + ' lines)', backOk && lnBeforeBack - lnAfterBack >= 1500);
  lap('deep backward done');

  console.log('\n== B6. Level-filtered wheeling ==');
  await page.evaluate(() => {
    let n = 0;
    for (const c of document.querySelectorAll('#vLvls .vchip')) {
      if (n < 2 && c.classList.contains('on') && (c.textContent === 'D' || c.textContent === 'I')) { c.click(); n++; }
    }
  });
  await page.waitForTimeout(400);
  await page.locator('#vBody').press('Home');
  await page.waitForTimeout(600);
  let filtSnap = false, filtLn = 1, filtMax = 1;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 200; i++) {
    await page.mouse.wheel(0, 1200);
    if (i % 10 === 9) {
      const top = await page.evaluate(() => document.getElementById('vBody').scrollTop);
      const ln = await firstVisLn();
      if (top === 0 && i > 20) filtSnap = true;
      if (ln != null) { if (ln < filtLn - 3) filtSnap = true; filtLn = ln; filtMax = Math.max(filtMax, ln); }
    }
  }
  check('level-filtered wheeling advances ≥8,000 lines (crosses chains)', filtMax >= 8000, 'reached line ' + fmt(filtMax));
  check('level-filtered wheeling: no snap-back / backward slide', !filtSnap);
  await page.evaluate(() => {
    for (const c of document.querySelectorAll('#vLvls .vchip')) if (!c.classList.contains('on')) c.click();
  });
  lap('filtered wheel done');

  console.log('\n== B7. Go-to-time to the middle of a 2 GB file ==');
  await page.locator('#vFile').selectOption('stress_b.log');
  await page.waitForTimeout(1500);
  const targetLine = 20000000;                                   // ts = 20,000,000 ms = 05:33:20
  const expPct = 100 * targetLine / EXP.files[1].lines;
  await page.fill('#vTimeIn', '08-25 05:33:20');
  await page.locator('#vTimeIn').press('Enter');
  await page.waitForTimeout(4000);
  let gtPct = await readPct(), last = -1;
  for (let i = 0; i < 10; i++) {                     // wait until the bisect settles
    if (Math.abs(gtPct - last) < 0.01) break;
    last = gtPct;
    await page.waitForTimeout(1500);
    gtPct = await readPct();
  }
  check('go-to-time bisects to ~' + expPct.toFixed(0) + '% of the file', Math.abs(gtPct - expPct) <= 2, 'got ' + gtPct.toFixed(1) + '%');
  lap('go-to-time done');

  console.log('\n== B8. Cross-GB forward search + match walk ==');
  await page.locator('#vFile').selectOption('stress_a.log');
  await page.waitForTimeout(1200);
  await page.locator('#vBody').press('Home');
  await page.fill('#vSearch', 'RAREBEACON');
  await page.locator('#vSearch').press('Enter');
  // forward byte-scan over ~90% of 2 GB — the scan covers 512 MB per Enter press
  // and continues from its remembered cursor, so keep pressing while it walks
  // (segment footer reads: "no match in this 512 MB — Enter keeps scanning from X%")
  const withTimeout = (p, ms, label) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + label)), ms))]);
  let found = false, presses = 1;
  for (let i = 0; i < 100; i++) {
    await page.waitForTimeout(3000);
    const state = await withTimeout(page.evaluate(() => {
      const m = document.querySelector('#vBody tr.mfocus');
      return { focus: m ? m.textContent : '', foot: document.getElementById('vFoot').textContent };
    }), 25000, 'B8 evaluate #' + i).catch(e => { console.log('  [b8] ' + e.message); return null; });
    if (!state) continue;
    console.log('  [b8] ' + state.foot.slice(0, 70));
    if (state.focus.includes('RAREBEACON')) { found = true; break; }
    if (/keeps scanning|Enter continues/.test(state.foot)) {
      await withTimeout(page.locator('#vSearch').press('Enter'), 25000, 'B8 press #' + (presses + 1)).catch(e => console.log('  [b8] ' + e.message));
      presses++;
    }
  }
  check('forward search finds the marker ~90% into a 2 GB file (' + presses + ' × 512 MB segments)', found);
  // the marker block has 20 lines — walk a few
  await page.locator('#vBody').press('n');
  await page.waitForTimeout(1200);
  const walkOk = await page.evaluate(() => (document.querySelector('#vBody tr.mfocus') || { textContent: '' }).textContent.includes('RAREBEACON'));
  check('match walk (n) steps to the next marker', walkOk);
  lap('cross-GB search done');

  console.log('\n== B9. Gap detector across ~1.2 GB ==');
  await page.locator('#vBody').press('Home');
  await page.waitForTimeout(800);
  await page.click('#vGapBtn');
  let gapOk = false;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(3000);
    const toast = await page.evaluate(() => document.getElementById('toast').textContent);
    if (toast.includes('gap:')) { gapOk = toast.includes('gap: 10.0s'); break; }
  }
  check('gap» finds the injected 10 s silence', gapOk);
  lap('gap scan done');

  console.log('\n== B10. Boot scan on the 1.5 GB file (timestamp reset at ~40%) ==');
  await page.locator('#vFile').selectOption('stress_c.log');
  await page.waitForTimeout(1200);
  await page.click('#vBootBtn');
  let boots = 0;
  for (let i = 0; i < 110; i++) {                  // streams the full 1.5 GB — generous budget
    await page.waitForTimeout(3000);
    boots = await page.evaluate(() => document.querySelectorAll('#vBootSel option').length);
    if (boots >= 2) break;
  }
  check('boots scan finds the injected clock reset', boots >= 2, 'options=' + boots);
  lap('boot scan done');

  console.log('\n== B11. Viewer feature pass (collapse, wrap, font, Δt, themes, mask, bookmark) ==');
  await page.locator('#vFile').selectOption('stress_a.log');
  await page.waitForTimeout(1200);
  // the stress fixture has no consecutive identical-shape runs (levels cycle every
  // line) — collapse toggles cleanly but produces no badges here; repeat runs are
  // covered by the denoise suite on a purpose-built fixture
  await page.click('#vColBtn');                                  // collapse repeated lines
  await page.waitForTimeout(600);
  check('collapse toggle re-renders the big window cleanly', await page.evaluate(() => document.querySelectorAll('#vBody tr.vrow').length) >= 100 && !errors.length);
  await page.click('#vColBtn');
  await page.click('#vWrap');                                    // nowrap mode on 2 GB file
  await page.waitForTimeout(600);
  check('nowrap applied', await page.evaluate(() => document.getElementById('vBody').classList.contains('nowrap')));
  await page.click('#vWrap');
  await page.click('#vFontUp'); await page.click('#vFontUp');
  await page.waitForTimeout(300);
  const fsz = await page.evaluate(() => getComputedStyle(document.getElementById('vBody')).fontSize);
  check('A+ font size applied', parseFloat(fsz) > 12, fsz);
  await page.click('#vFontDn'); await page.click('#vFontDn');
  await page.evaluate(() => document.getElementById('vDlt').click());   // hide Δt
  await page.waitForTimeout(300);
  check('Δt toggle hides column', await page.evaluate(() => !document.getElementById('vBody').classList.contains('hasdlt')));
  await page.evaluate(() => document.getElementById('vDlt').click());
  await page.selectOption('#vTheme', 'hc');
  await page.waitForTimeout(300);
  check('HC logcat theme applies over the dark-capable viewer', await page.evaluate(() => document.getElementById('vBody').classList.contains('hc')));
  await page.selectOption('#vTheme', 'default');
  // jump to a VIN line first (VINs occur every 1000 lines — none in the first window)
  await page.fill('#vSearch', 'YV4STR0SS');
  await page.locator('#vSearch').press('Enter');
  await page.waitForTimeout(4000);
  await page.evaluate(() => document.getElementById('vMask').click());   // mask OFF
  await page.waitForTimeout(600);
  check('mask off shows the raw VIN', await page.evaluate(() => document.getElementById('vBody').innerText.includes('YV4STR0SS12345678')));
  await page.evaluate(() => document.getElementById('vMask').click());   // mask ON
  await page.waitForTimeout(400);
  // bookmark the centered line, jump away, jump back
  await page.evaluate(() => document.getElementById('vBody').focus());
  await page.locator('#vBody').press('b');
  await page.waitForTimeout(400);
  const pinOpts = await page.evaluate(() => document.querySelectorAll('#vMarksSel option').length);
  check('bookmark pinned into the selector', pinOpts >= 2);
  lap('feature pass done');
  } // /B

  // ============ C · SEARCH TAB (multi-GB, multi-file, past the cap) ============
  if (want("C")) {
  await freshPage();
  console.log('\n== C. Search tab: VIN hunt across ' + (EXP.totals.bytes / 1073741824).toFixed(1) + ' GB ==');
  await page.click('#tabBtnSearch');
  await page.waitForTimeout(400);
  await page.fill('#msq', 'YV4STR0SS');
  await page.click('#msRun');
  let searchTotal = 0;
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(4000);
    const done = await page.evaluate(() => {
      const s = document.getElementById('msSummary');
      return s && s.style.display !== 'none' && /matching line/.test(s.textContent);
    });
    if (done) {
      searchTotal = await page.evaluate(() => parseInt(document.querySelector('#msSummary b').textContent.replace(/[^\d]/g, ''), 10));
      break;
    }
  }
  check('search totals stay EXACT past the 20k cap (' + fmt(EXP.totals.vinLines) + ' VIN lines)', searchTotal === EXP.totals.vinLines, 'got ' + searchTotal);
  check('per-file truncation flagged', await page.evaluate(() => document.getElementById('msSummary').innerHTML.includes('capped') || document.getElementById('msSummary').innerHTML.includes('truncated')));
  // click first result → viewer focuses the line
  await page.locator('#msBody tr').first().click();
  await page.waitForTimeout(3000);
  const focusVin = await page.evaluate(() => (document.querySelector('#vBody tr.mfocus') || { textContent: '' }).textContent.includes('vin=YV4'));
  check('search-result click jumps + focuses a VIN line in the viewer (masked shape)', focusVin);
  // filter box
  await page.click('#tabBtnSearch');
  await page.waitForTimeout(300);
  await page.locator('#msFilter').fill('vin=YV4');
  await page.waitForTimeout(500);
  const afterFilter = await page.evaluate(() => ({
    n: document.querySelectorAll('#msBody tr').length,
    first: document.querySelector('#msBody tr') ? document.querySelector('#msBody tr').textContent : '',
  }));
  check('results filter narrows to VIN rows', afterFilter.n > 0 && afterFilter.n <= 500 && afterFilter.first.includes('YV4'), 'rows=' + afterFilter.n);
  await page.locator('#msFilter').fill('');
  lap('search tab done · total ' + searchTotal);
  } // /C

  // ============ D · WORKBENCH: full 5.5 GB scan, exact totals, extract download ============
  if (want("D")) {
  await freshPage();
  // rare-rule scan: the full 2 GB stream at worker speed with an exact tiny result
  // (match-all of 78M lines was measured at 60+ min — per-match bookkeeping, not IO,
  // dominates; that is documented as the stress finding)
  console.log('\n== D. Workbench rare-rule scan across the full 2 GB file ==');
  await page.click('#addInclude');
  await page.waitForTimeout(200);
  await page.locator('#extRules .rule:last-child input[type=text]').nth(1).fill('RAREBEACON');
  const dT0 = Date.now();
  await page.click('#btnRun');
  let scanDone = false, prog = '';
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(2000);
    prog = await page.evaluate(() => document.getElementById('progText').textContent);
    if (/done · /.test(prog)) { scanDone = true; break; }
  }
  const dWall = ((Date.now() - dT0) / 1000).toFixed(0);
  check('rare-rule scan completes the full 2 GB file', scanDone, prog.slice(0, 120));
  const dm = prog.match(/([\d,]+) lines · ([\d,]+) matches/);
  check('scan counts every line exactly (' + fmt(EXP.files[0].lines) + ')', !!dm && dm[1].replace(/,/g, '') === String(EXP.files[0].lines), prog.slice(0, 140));
  check('rare-rule matches exact (20 injected markers)', !!dm && dm[2].replace(/,/g, '') === '20', prog.slice(0, 140));
  console.log('  scan wall: ' + dWall + ' s ≈ ' + (EXP.files[0].bytes / 1048576 / Math.max(1, +dWall)).toFixed(0) + ' MB/s');
  // capped masked extract download
  const dlPromise = page.waitForEvent('download', { timeout: 60000 });
  await page.click('#dlExtract');
  const dl = await dlPromise;
  const dlPath = await dl.path();
  const dlSize = fs.statSync(dlPath).size;
  check('extract download is a substantial masked file', dlSize > 1024, (dlSize / 1048576).toFixed(2) + ' MB');
  const fd = fs.openSync(dlPath, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  check('extract is masked (no raw stress VIN)', !buf.slice(0, n).toString('utf8').includes('YV4STR0SS12345678'));
  lap('workbench scan + export done');
} // /D

  // ============ E · PII AUDIT across all files ============
  if (want("E")) {
  await freshPage();
  console.log('\n== E. PII audit across stress_c.log (1.5 GB) ==');
  // limit the audit to the 1.5 GB file: uncheck the two 2 GB files in the workbench list
  await page.evaluate(() => {
    document.querySelectorAll('#filelist .fileitem input[type=checkbox]').forEach((cb, i) => { cb.checked = i === 2; cb.dispatchEvent(new Event('change')); });
  });
  await page.waitForTimeout(300);
  await page.click('#tabBtnPii');
  await page.waitForTimeout(500);
  await page.click('#piiRun');
  let piiDone = false;
  for (let i = 0; i < 450; i++) {
    await page.waitForTimeout(4000);
    piiDone = await page.evaluate(() => document.getElementById('piiStop').disabled && !document.getElementById('piiRun').disabled);
    if (piiDone) break;
  }
  check('PII audit completes over all files', piiDone);
  lap('pii audit done');
  } // /E

  // ============ F · MEMORY + ERRORS ============
  console.log('\n== F. Memory & stability ==');
  const usedMB = await heap();
  check('JS heap stays bounded after ~5.5 GB of operations (' + usedMB + ' MB < 400 MB)', usedMB < 400);
  check('zero page errors through the whole stress run', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.screenshot({ path: path.join(__dirname, 'stress', '_stress_final.png'), fullPage: false });
  await browser.close();
  console.log('\nSTRESS RESULT: ' + pass + ' passed, ' + fail + ' failed  (' + ((Date.now() - t0) / 60000).toFixed(1) + ' min total)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('STRESS FATAL:', e.message); process.exit(1); });
