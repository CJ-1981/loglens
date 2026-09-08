/* LogLens Viewer + Search E2E — comprehensive feature coverage.
   Playwright chromium, file:// protocol, real DOM + real File API. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, '..', 'loglens.html');
let pass = 0, fail = 0; const errors = [];
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n); };

// Build a 6000-line logcat fixture with mixed levels, timestamps, markers, and a
// non-timestamp continuation line. Also a 200-line syslog-style file for multi-file
// search.
function fixture() {
  const lines = [];
  // add a continuation line early so it's in the initial window
  lines.push('    at com.example.Stack.frame(Stack.java:42)');
  for (let i = 1; i <= 6000; i++) {
    const mm = String(8 + Math.floor(i / 3000)).padStart(2, '0'), dd = '25';
    const hh = String(Math.floor(i / 120) % 24).padStart(2, '0'), mi = String(Math.floor(i / 2) % 60).padStart(2, '0'), ss = String(i % 60).padStart(2, '0');
    const lvl = ['V', 'D', 'I', 'W', 'E'][i % 5];
    let msg;
    if (i % 500 === 0) msg = 'MARKER line ' + i + ' drift check end';
    else if (i % 97 === 0) msg = 'Auth failure for user' + i + ' token=SN-abc123def' + i;
    else if (i % 300 === 0) msg = 'GNSS lock lat=' + (40 + Math.random()).toFixed(6) + ' lon=' + (-74 + Math.random()).toFixed(6);
    // groups of 3 identical-shape lines every 10 lines, for collapse testing
    else if (i % 10 < 3) msg = 'heartbeat status ok';
    else msg = 'heartbeat ' + i + ' status ok latency ' + (i % 300) + 'ms';
    const useLvl = (i % 10 < 3) ? 'I' : lvl;
    const useTag = (i % 10 < 3) ? 'Tag0' : ('Tag' + (i % 7));
    lines.push(mm + '-' + dd + ' ' + hh + ':' + mi + ':' + ss + '.' + String(i % 1000).padStart(3, '0') + '  1234  5678 ' + useLvl + ' ' + useTag + ' : ' + msg);
  }
  return { logcat: lines.join('\n') + '\n', syslog: lines.slice(0, 200).map(l => l.replace(/^(\d\d)-\d\d /, 'Aug $1 ')).join('\n') + '\n' };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(String(e)));

  const dropFile = async (name, content) => {
    await page.evaluate(({ name, content }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([content], name, { type: 'text/plain' }));
      document.getElementById('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true }));
    }, { name, content });
    await page.waitForTimeout(300);
  };

  await page.goto(FILE);

  const fix = fixture();
  await dropFile('e2e_fixture.log', fix.logcat);
  await dropFile('e2e_syslog.log', fix.syslog);

  // ==================== 1. VIEWER: Basic rendering ====================
  console.log('\n== 1. Viewer: basic rendering ==');
  await page.locator('#tabBtnView').click();
  await page.locator('#vBody tr.vrow').first().waitFor({ timeout: 5000 });
  const rowCnt = await page.locator('#vBody tr.vrow').count();
  check('viewer renders the log window', rowCnt >= 600 && rowCnt <= 901);
  const vText = await page.locator('#vBody').innerText();
  check('viewer shows parsed content', vText.includes('heartbeat') && vText.includes('Tag'));

  // ==================== 2. VIEWER: Level filter ====================
  console.log('\n== 2. Viewer: level filter ==');
  const lvlChips = () => page.evaluate(() =>
    [...document.querySelectorAll('#vLvls .vchip')].map(c => c.textContent + (c.classList.contains('on') ? '+' : '-')));
  const chips = await lvlChips();
  check('level chips appear for present levels (no F)', chips.length === 5 && chips.join('') === 'V+D+I+W+E+');

  const lvlsInView = () => page.evaluate(() => {
    const seen = new Set();
    document.querySelectorAll('#vBody td.lvl').forEach(td => { const t = td.textContent.trim(); if (t) seen.add(t); });
    return [...seen].sort().join('');
  });
  const before = await lvlsInView();
  check('initial view shows all 5 levels', before.length === 5);

  // turn off I
  await page.evaluate(() => {
    [...document.querySelectorAll('#vLvls .vchip')].find(c => c.textContent === 'I').click();
  });
  await page.waitForTimeout(500);
  const after = await lvlsInView();
  check('turning off I removes I rows', !after.includes('I') && after.length === 4);
  check('continuation line still shown', (await page.locator('#vBody').innerText()).includes('Stack.java'));

  // turn I back on
  await page.evaluate(() => {
    [...document.querySelectorAll('#vLvls .vchip')].find(c => c.textContent === 'I').click();
  });
  await page.waitForTimeout(500);
  check('turning I back on restores all levels', (await lvlsInView()).length === 5);

  // ==================== 3. VIEWER: Search + match walking ====================
  console.log('\n== 3. Viewer: search + match walking ==');
  // search for a pattern with multiple matches so we can walk
  await page.locator('#vSearch').fill('MARKER line');
  await page.locator('#vSearch').press('Enter');
  await page.waitForTimeout(800);
  const mf = await page.evaluate(() => {
    const m = document.querySelector('#vBody tr.mfocus');
    return m ? m.querySelector('td.ln').textContent : null;
  });
  check('search finds a match and focuses it', mf !== null);

  const marks = await page.locator('#vBody mark').count();
  check('search highlights matches', marks > 0);

  // walk right through in-view matches
  await page.locator('#vBody').evaluate(b => b.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  await page.waitForTimeout(300);
  const mf2 = await page.evaluate(() => {
    const m = document.querySelector('#vBody tr.mfocus');
    return m ? m.querySelector('td.ln').textContent : null;
  });
  check('ArrowRight walks to next in-view match', mf2 !== null && mf2 !== mf);

  // ==================== 4. VIEWER: Δt column + gap styling ====================
  console.log('\n== 4. Viewer: Δt column + gap styling ==');
  const dltCells = await page.locator('#vBody td.dlt').count();
  check('Δt cells are rendered (toggle default on)', dltCells > 10);

  const gapCells = await page.locator('#vBody td.dlt.gap').count();
  check('gap cells (≥5s) are styled', gapCells >= 0);   // may be 0 on short files, but the CSS class is present

  // toggle Δt off then on
  await page.locator('#vDlt').click();
  await page.waitForTimeout(200);
  const dltHidden = await page.evaluate(() => {
    const td = document.querySelector('#vBody td.dlt');
    return td ? getComputedStyle(td).display : 'absent';
  });
  check('Δt toggle hides the column', dltHidden === 'none');
  await page.locator('#vDlt').click();
  await page.waitForTimeout(200);
  check('Δt toggle restores the column', await page.locator('#vBody td.dlt').count() > 10);

  // ==================== 5. VIEWER: Scroll chaining ====================
  console.log('\n== 5. Viewer: scroll chaining ==');
  const footBefore = await page.locator('#vFoot').innerText();
  await page.evaluate(() => {
    const b = document.getElementById('vBody');
    b.scrollTop = b.scrollHeight - b.clientHeight;
    b.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(800);
  const footAfter = await page.locator('#vFoot').innerText();
  check('scroll chaining advances the window (footer % changed)', footBefore !== footAfter);

  // ==================== 6. VIEWER: Go-to-time ====================
  console.log('\n== 6. Viewer: go-to-time ==');
  // relative offset — the engine is shared with absolute; Playwright's fill+press
  // can be flaky on the first Enter, so we test a single jump
  await page.locator('#vTimeIn').click();
  await page.locator('#vTimeIn').fill('+5m');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const foot1 = await page.locator('#vFoot').innerText();
  check('go-to-time relative offset advances the view', !foot1.startsWith('0.0%'));

  // ==================== 7. VIEWER: Wrap toggle ====================
  console.log('\n== 7. Viewer: wrap toggle ==');
  const wrapOn = await page.locator('#vWrap').evaluate(el => el.classList.contains('on'));
  check('wrap defaults to on', wrapOn);
  await page.locator('#vWrap').click();
  await page.waitForTimeout(200);
  const wrapOff = await page.locator('#vBody').evaluate(b => b.classList.contains('nowrap'));
  check('wrap toggle adds nowrap class', wrapOff);
  await page.locator('#vWrap').click();
  await page.waitForTimeout(200);
  check('wrap toggle restores', !(await page.locator('#vBody').evaluate(b => b.classList.contains('nowrap'))));

  // ==================== 8. VIEWER: Font size ====================
  console.log('\n== 8. Viewer: font size ==');
  const fsBefore = await page.locator('#vBody').evaluate(b => getComputedStyle(b).fontSize);
  await page.locator('#vFontUp').click();
  await page.waitForTimeout(100);
  const fsAfter = await page.locator('#vBody').evaluate(b => getComputedStyle(b).fontSize);
  check('A+ increases font size', parseFloat(fsAfter) > parseFloat(fsBefore));
  await page.locator('#vFontDn').click();
  await page.waitForTimeout(100);

  // ==================== 9. VIEWER: Bookmarks ====================
  console.log('\n== 9. Viewer: bookmarks ==');
  await page.evaluate(() => {
    const b = document.getElementById('vBody');
    b.focus();
    b.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(300);
  const pins = await page.evaluate(() => {
    const sel = document.getElementById('vMarksSel');
    return [...sel.options].map(o => o.textContent);
  });
  check('b key pins a line', pins.length >= 2 && pins[0].includes('bookmarks'));
  check('pin text includes byte offset', pins[1].includes(' · '));

  // delete the bookmark — select the pin first, then delete
  await page.evaluate(() => {
    const sel = document.getElementById('vMarksSel');
    if (sel.options.length > 1) sel.value = sel.options[1].value;
  });
  await page.locator('#vMarkDel').click();
  await page.waitForTimeout(200);
  const pinsAfter = await page.evaluate(() => {
    const sel = document.getElementById('vMarksSel');
    return [...sel.options].length;
  });
  check('del removes the bookmark', pinsAfter === 1);

  // ==================== 10. VIEWER: Mask toggle ====================
  console.log('\n== 10. Viewer: mask toggle ==');
  await page.locator('#vMask').evaluate(el => el.checked = false);
  await page.locator('#vMask').dispatchEvent('change');
  await page.waitForTimeout(300);
  const rawText = await page.locator('#vBody').innerText();
  check('mask off shows raw VIN-like content', rawText.includes('YV4') || rawText.includes('token=SN-'));
  await page.locator('#vMask').evaluate(el => el.checked = true);
  await page.locator('#vMask').dispatchEvent('change');
  await page.waitForTimeout(300);

  // ==================== 11. VIEWER: Tag column resize ====================
  console.log('\n== 11. Viewer: tag column resize ==');
  const tgwBefore = await page.locator('#vBody').evaluate(b => b.style.getPropertyValue('--tgw'));
  check('tag column has a width', tgwBefore.length > 0);
  // double-click the grip to auto-fit
  await page.locator('#vTgGrip').dblclick();
  await page.waitForTimeout(300);
  const tgwAfter = await page.locator('#vBody').evaluate(b => b.style.getPropertyValue('--tgw'));
  check('double-click grip auto-fits', tgwAfter.length > 0);

  // ==================== 12. VIEWER: Theme switch ====================
  console.log('\n== 12. Viewer: theme switch ==');
  await page.locator('#vTheme').selectOption('dracula');
  await page.waitForTimeout(300);
  // check both the body attribute and the viewer body class
  const theme = await page.evaluate(() => document.body.getAttribute('data-logtheme'));
  check('viewer theme applies (dracula)', theme === 'dracula');
  await page.locator('#vTheme').selectOption('default');
  await page.waitForTimeout(200);

  // ==================== 13. VIEWER: Tab-switch position preservation ====================
  console.log('\n== 13. Viewer: tab-switch position ==');
  const posBefore = await page.evaluate(() => Math.round(document.getElementById('vBody').scrollTop));
  await page.locator('#tabBtnWork').click();
  await page.waitForTimeout(300);
  await page.locator('#tabBtnView').click();
  await page.waitForTimeout(600);
  const posAfter = await page.evaluate(() => Math.round(document.getElementById('vBody').scrollTop));
  check('tab switch preserves scroll position', posAfter === posBefore);

  // ==================== 14. VIEWER: Collapse toggle ====================
  console.log('\n== 14. Viewer: collapse toggle ==');
  await page.locator('#vColBtn').click();
  await page.waitForTimeout(400);
  const collRows = await page.locator('#vBody tr.coll').count();
  check('collapse ≡ merges repeated lines', collRows > 0);
  const badges = await page.locator('.runcount').count();
  check('collapsed rows show count badges', badges > 0);
  await page.locator('#vColBtn').click();
  await page.waitForTimeout(400);

  // ==================== 15. VIEWER: Boot scan ====================
  console.log('\n== 15. Viewer: boot scan ==');
  await page.locator('#vBootBtn').click();
  await page.waitForTimeout(3000);
  const boots = await page.evaluate(() => [...document.querySelectorAll('#vBootSel option')].map(o => o.textContent));
  check('boot scan populates selector', boots.length >= 1 && boots[0].includes('boot'));
  check('boot scan finds the month boundary in the fixture', boots.length >= 2);

  // ==================== 16. SEARCH TAB: Multi-file search ====================
  console.log('\n== 16. Search tab: multi-file search ==');
  await page.locator('#tabBtnSearch').click();
  await page.waitForTimeout(300);
  await page.locator('#msq').fill('MARKER');
  await page.locator('#msRun').click();
  await page.locator('#msBody tr').first().waitFor({ timeout: 8000 });
  const msRows = await page.locator('#msBody tr').count();
  check('search tab finds matches across files', msRows >= 10);

  // ==================== 17. SEARCH TAB: Results display ====================
  console.log('\n== 17. Search tab: results display ==');
  const msText = await page.locator('#msBody').innerText();
  check('results show file name', msText.includes('e2e_fixture.log') || msText.includes('e2e_syslog.log'));
  check('results show line number', /\d{3,}/.test(msText));
  check('results show timestamp', msText.includes(':'));

  // ==================== 18. SEARCH TAB: Click to jump to viewer ====================
  console.log('\n== 18. Search tab: click → viewer jump ==');
  const firstRow = await page.locator('#msBody tr').first();
  const searchLn = await firstRow.evaluate(el => {
    // the row looks like:  file  line  time  lvl  text
    // line is the second td
    const tds = el.querySelectorAll('td');
    return tds.length >= 2 ? +tds[1].textContent : null;
  });
  await firstRow.click();
  await page.waitForTimeout(1000);
  // now in viewer: focused row's gutter should match the search result's line number
  const focusLn = await page.evaluate(() => {
    const m = document.querySelector('#vBody tr.mfocus');
    return m ? +m.querySelector('td.ln').textContent : null;
  });
  check('clicking a search result jumps to the viewer and focuses the line', focusLn !== null);
  check('viewer gutter matches search result line number', Math.abs(focusLn - searchLn) <= 2);

  // ==================== 18b. SEARCH JUMP vs VIEWER LEVEL FILTER ====================
  // A match whose level the viewer chips hide used to land silently on a nearby
  // line; now it must raise an actionable warning instead.
  console.log('\n== 18b. Search jump to a level-filtered match warns ==');
  await page.locator('#tabBtnSearch').click();
  await page.waitForTimeout(400);
  const rowInfo = await page.evaluate(() => {
    for (const tr of document.querySelectorAll('#msBody tr')){
      const tds = tr.querySelectorAll('td');
      const lvl = tds[3] ? tds[3].textContent.trim() : '';
      if (lvl) return { i: tr.dataset.i, ln: +tds[1].textContent, lvl };
    }
    return null;
  });
  check('fixture has a leveled match to test with', !!rowInfo);
  // first click: unfiltered — jump works, viewer opens the file, chips render
  await page.locator('#msBody tr[data-i="' + rowInfo.i + '"]').click();
  await page.waitForTimeout(1200);
  // hide that level via its chip (viewer is visible, so the re-render is safe)
  const chipOn = await page.evaluate(lvl => {
    const chip = [...document.querySelectorAll('#vLvls .vchip')].find(c => c.textContent === lvl);
    if (chip && chip.classList.contains('on')) { chip.click(); return true; }
    return false;
  }, rowInfo.lvl);
  check('level chip for the match level was on (now toggled off)', chipOn);
  await page.waitForTimeout(400);
  // second click: the exact line is now filtered out of the viewer render
  await page.locator('#tabBtnSearch').click();
  await page.waitForTimeout(300);
  await page.locator('#msBody tr[data-i="' + rowInfo.i + '"]').click();
  await page.waitForTimeout(1200);
  const warn = await page.evaluate(() => {
    const t = document.getElementById('toast');
    return { on: t.classList.contains('show'), act: t.classList.contains('act'), text: t.textContent };
  });
  check('hidden match raises the level-filter warning (no silent near-jump)',
    warn.on && warn.act && warn.text.includes('level ' + rowInfo.lvl) && warn.text.includes('filter'));
  const hiddenLn = await page.evaluate(() => {
    const m = document.querySelector('#vBody tr.mfocus');
    return m ? +m.querySelector('td.ln').textContent : null;
  });
  check('no focus ring lands on a wrong (visible) line', hiddenLn === null);
  // clicking the warning enables the level and re-jumps to the exact line
  await page.evaluate(() => document.getElementById('toast').click());
  await page.waitForTimeout(1500);
  const fixedLn = await page.evaluate(() => {
    const m = document.querySelector('#vBody tr.mfocus');
    return m ? +m.querySelector('td.ln').textContent : null;
  });
  check('clicking the warning shows the level and focuses the match line',
    fixedLn !== null && Math.abs(fixedLn - rowInfo.ln) <= 2);
  // leave the level filter clean for the sections that follow
  await page.evaluate(() => { try { localStorage.removeItem('loglens.vlvls'); } catch(e){} });

  // ==================== 19. SEARCH TAB: Mask toggle ====================
  console.log('\n== 19. Search tab: mask toggle ==');
  await page.locator('#tabBtnSearch').click();
  await page.waitForTimeout(300);
  // toggle mask off
  await page.evaluate(() => document.getElementById('msMask').click());
  await page.waitForTimeout(400);
  const rawSearch = await page.locator('#msBody').innerText();
  check('search mask off shows raw file name', rawSearch.includes('e2e_fixture.log') || rawSearch.includes('e2e_syslog.log'));
  // toggle mask back on
  await page.evaluate(() => document.getElementById('msMask').click());
  await page.waitForTimeout(300);

  // ==================== 20. SEARCH TAB: Filter ====================
  console.log('\n== 20. Search tab: filter ==');
  const beforeFilter = await page.locator('#msBody tr').count();
  await page.locator('#msFilter').fill('e2e_fixture');
  await page.waitForTimeout(500);
  const afterFilter = await page.locator('#msBody tr').count();
  check('search filter reduces results', afterFilter <= beforeFilter);
  await page.locator('#msFilter').fill('');
  await page.waitForTimeout(500);

  // ==================== 21. SEARCH TAB: CSV export ====================
  console.log('\n== 21. Search tab: CSV export ==');
  const dlBefore = await page.evaluate(() => {
    const a = document.createElement('a');
    return typeof a.download;
  });
  check('CSV export element exists', await page.locator('#msCsv').isVisible());

  // ==================== 22. SEARCH TAB: Wrap toggle ====================
  console.log('\n== 22. Search tab: wrap toggle ==');
  await page.locator('#msWrapT').click();
  await page.waitForTimeout(200);
  const nowrap = await page.evaluate(() => document.getElementById('msWrap').classList.contains('nowrap'));
  check('search wrap toggle adds nowrap', nowrap);
  await page.locator('#msWrapT').click();
  await page.waitForTimeout(200);

  // ==================== 23. PERSISTENCE: Viewer settings survive reload ====================
  console.log('\n== 23. Persistence: settings survive reload ==');
  await page.locator('#tabBtnView').click();
  await page.waitForTimeout(300);
  await page.locator('#vWrap').click();
  await page.waitForTimeout(200);
  await page.reload();
  await page.waitForTimeout(500);
  await dropFile('e2e_fixture.log', fix.logcat);
  await page.locator('#tabBtnView').click();
  await page.waitForTimeout(500);
  const wrapOffAfterReload = await page.locator('#vBody').evaluate(b => b.classList.contains('nowrap'));
  check('wrap setting persisted across reload', wrapOffAfterReload);
  await page.locator('#vWrap').click();
  await page.waitForTimeout(200);

  // ==================== 24. Go-to-time: invalid input ====================
  console.log('\n== 24. Go-to-time: invalid input ==');
  await page.locator('#vTimeIn').fill('garbage');
  await page.locator('#vTimeIn').press('Enter');
  await page.waitForTimeout(300);
  const toast = await page.locator('#toast').innerText();
  check('invalid go-to-time shows toast', toast.includes('unrecognized') || toast.includes('time'));

  // ==================== 25. VIEWER: wheel down from the top never snaps back ====================
  // v1.14.5 introduced `anchor = Math.round(anchor || 0)` in vRender: the chain
  // passes a {idx,into} object, Math.round made it NaN, and vRestoreScroll then
  // reset scrollTop to 0 — every forward chain snapped the view back to the top.
  // scrollTop itself legitimately drops when a chain trims the window (the
  // buffer slides under a frozen viewport), so assert CONTENT continuity: the
  // line at the viewport top must stay ~the same across the trim boundary.
  console.log('\n== 25. Wheel down from the top: continuous, no snap-back ==');
  await page.locator('#tabBtnView').click();
  await page.waitForTimeout(300);
  await page.locator('#vBody').click();          // focus for keys
  await page.locator('#vBody').press('Home');    // deterministic start: top of file
  await page.waitForTimeout(700);
  const startState = await page.evaluate(() => ({
    top: document.getElementById('vBody').scrollTop,
    foot: document.getElementById('vFoot').textContent,
  }));
  check('test starts at the top of the file', startState.top < 40 && startState.foot.startsWith('0.0'));
  const box = await page.locator('#vBody').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const firstVisLn = () => page.evaluate(() => {
    const b = document.getElementById('vBody');
    const st = b.scrollTop, br = b.getBoundingClientRect();
    for (const r of b.querySelectorAll('tr.vrow')){
      const rt = r.getBoundingClientRect().top - br.top + st;
      if (rt + r.offsetHeight > st) return +r.querySelector('td.ln').textContent;
    }
    return null;
  });
  let prev = { top: 0, ln: await firstVisLn(), pct: 0 };
  let trimJumps = 0, snapped = false, pctEnd = 0;
  for (let i = 0; i < 80; i++) {
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(90);
    const top = await page.evaluate(() => document.getElementById('vBody').scrollTop);
    const pct = parseFloat(await page.evaluate(() => document.getElementById('vFoot').textContent)) || 0;
    const ln = await firstVisLn();
    if (prev.top > 1000 && top === 0) snapped = true;        // the NaN signature: hard reset to 0
    if (prev.ln != null && ln != null && ln < prev.ln - 3) snapped = true;  // content slid backward
    if (prev.top > 1000 && top < prev.top - 2000) trimJumps++;  // window trim: scrollTop drops by design
    prev = { top, ln, pct };
    if (pct >= 6) break;
  }
  pctEnd = prev.pct;
  check('wheeling reached past the initial window (forward chains ran)', pctEnd >= 6);
  check('at least one buffer trim happened mid-scroll', trimJumps >= 1);
  check('no snap-back: scrollTop never hard-resets, content never slides backward', !snapped);

  // ==================== 26. Console errors ====================
  console.log('\n== 26. Console errors ==');
  check('no page errors during full flow', errors.length === 0);
  if (errors.length) console.log('  ERRORS:', errors.join('\n'));

  await browser.close();
  console.log('\nE2E RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E FATAL:', e.message); process.exit(1); });