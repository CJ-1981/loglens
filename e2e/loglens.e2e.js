/* LogLens E2E — real Chromium (Playwright), drives the actual UI.
   Covers: workbench demo flow, run, viewer browsing + masking, search-jump,
   theme switching, and console-error surveillance. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');

const FILE = 'file://' + path.resolve(__dirname, '..', 'loglens.html');
let pass = 0, fail = 0; const errors = [];
const check = (n, c) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(FILE);

  // ---------- 1. workbench: demo load ----------
  await page.locator('#btnDemo').click();
  await page.locator('#filelist .fileitem').first().waitFor({ timeout: 3000 });
  const files = await page.locator('#filelist .fileitem').count();
  check('demo adds a file to the input list', files === 1);

  // ---------- 2. run extraction ----------
  await page.locator('#btnRun').click();
  await page.locator('#statsCard').waitFor({ state: 'visible', timeout: 5000 });
  const statText = await page.locator('#statCards').innerText();
  check('scan completes with matches', /matched/i.test(statText) && !/matched\s*\n0/.test(statText));
  check('results table has rows', await page.locator('#resBody tr').count() > 3);

  // ---------- 2b. results table zebra + dark theme legibility ----------
  const resZebra = await page.evaluate(() => {
    const seen = new Set();
    for (const tr of document.querySelectorAll('#resBody tr')){
      const td = tr.querySelector('td');
      if (td) seen.add(getComputedStyle(td).backgroundColor);
      if (seen.size > 1) break;
    }
    return seen.size;
  });
  check('results table zebra striping', resZebra > 1);

  // ---------- 3. viewer: demo visible + masked ----------
  await page.locator('#tabBtnView').click();
  await page.locator('#vBody .vrow').first().waitFor({ timeout: 3000 });
  const rowCnt = await page.locator('#vBody .vrow').count();
  check('viewer renders the log window', rowCnt >= 10);
  const vText = await page.locator('#vBody').innerText();
  check('viewer masks VIN on display', !vText.includes('YV4DEM0123AB34567'));
  check('viewer shows the service tag', vText.includes('MyApp'));

  // ---------- 4. viewer search-jump (demo file: whole file is in the window —
  //              a scan that starts past the view would find nothing: strict!) ----------
  await page.locator('#vSearch').fill('Auth');
  await page.locator('#vSearch').press('Enter');
  await page.locator('#vBody mark').first().waitFor({ timeout: 5000 });
  check('search finds in-view match and highlights it', await page.locator('#vBody mark').count() > 0);
  const footHit = await page.locator('#vFoot').innerText();
  check('footer confirms the hit', footHit.includes('\uD83D\uDD0D'));
  // a term that does not exist must report cleanly in the footer
  await page.locator('#vSearch').fill('ZZZNOSUCHTOKEN');
  await page.locator('#vSearch').press('Enter');
  await page.waitForTimeout(400);
  const footMiss = await page.locator('#vFoot').innerText();
  check('no-match reports in footer', footMiss.includes('no matches for'));

  // ---------- 4b. search clear (✕): query, highlights and footer reset ----------
  await page.locator('#vSearch').fill('Auth');
  await page.locator('#vSearch').press('Enter');
  await page.locator('#vBody mark').first().waitFor({ timeout: 5000 });
  await page.locator('#vSearchClr').click();
  check('clear button empties the search box', (await page.locator('#vSearch').inputValue()) === '');
  check('clear button removes all highlights', (await page.locator('#vBody mark').count()) === 0);
  const footClr = await page.locator('#vFoot').innerText();
  check('clear restores the status footer', !footClr.includes('\uD83D\uDD0D') && footClr.includes('lines'));
  // the ✕ only shows while the box holds text
  await page.locator('#vSearch').fill('Auth');
  check('clear button visible only with text', await page.locator('#vSearchClr').isVisible());
  await page.locator('#vSearchClr').click();
  await page.waitForTimeout(100);
  check('clear button hidden when empty', !(await page.locator('#vSearchClr').isVisible()));

  // ---------- 4c. focus ring must enclose the full unwrapped line (nowrap) ----------
  // asserted against the RIGHT EDGE of the rendered text (widest content element),
  // not scrollWidth — the v1.18.2 check had slack that hid a ~2-character shortfall
  await page.setInputFiles('#fpick', { name: 'longline.log', mimeType: 'text/plain',
    buffer: Buffer.from('08-24 15:37:01.000  0100  0100 I TagA: NEEDLE long line -> ' + 'X'.repeat(400) + ' <- end\n' +
                        'plain continuation without header NEEDLE raw ' + 'Y'.repeat(300) + ' rawend\n') });
  await page.locator('#vFile').selectOption('longline.log');
  await page.locator('#vBody .vrow').first().waitFor({ timeout: 3000 });
  await page.locator('#vWrap').click();          // one-line rows (nowrap, horizontal scroll)
  for (const q of ['NEEDLE long', 'NEEDLE raw']){
    await page.locator('#vSearch').fill(q);
    await page.locator('#vSearch').press('Enter');
    await page.locator('#vBody .vrow.mfocus').waitFor({ timeout: 5000 });
    const covers = await page.evaluate(() => {
      const row = document.querySelector('#vBody .vrow.mfocus');
      const cols = row.querySelector('.cols') || row.querySelector('.raw');
      let textRight = -Infinity;
      const spans = cols.querySelectorAll(':scope > span');
      if (spans.length) for (const s of spans){ const r = s.getBoundingClientRect(); if (r.right > textRight) textRight = r.right; }
      else textRight = cols.getBoundingClientRect().right - 10;   // .raw keeps 10px padding-right
      return { ringRight: row.getBoundingClientRect().right, textRight };
    });
    check(`focus ring covers the rendered text edge (${q})`, covers.ringRight >= covers.textRight - 0.5);
  }
  await page.locator('#vSearchClr').click();
  await page.locator('#vWrap').click();          // restore wrap for the remaining checks

  // ---------- 4d. zebra striping: adjacent rows must render different backgrounds ----------
  await page.locator('#vFile').selectOption('demo_sample.log');
  await page.locator('#vBody .vrow').nth(9).waitFor({ timeout: 3000 });
  const zebra = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#vBody .vrow')].slice(0, 3);
    return rows.map(r => getComputedStyle(r).backgroundColor);
  });
  check('zebra: alternating row backgrounds', zebra[0] !== zebra[1] && zebra[0] === zebra[2]);

  // ---------- 5. logcat theme switch (viewer toolbar selector) ----------
  await page.locator('#vTheme').selectOption('dracula');
  const bodyTheme = await page.evaluate(() => document.body.getAttribute('data-logtheme'));
  check('logcat theme applies (dracula)', bodyTheme === 'dracula');
  const surf = await page.evaluate(() => getComputedStyle(document.getElementById('vBody')).backgroundColor);
  check('viewer surface restyled (dracula bg)', surf === 'rgb(40, 42, 54)');
  const zebraD = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#vBody .vrow')].slice(0, 2);
    return rows.map(r => getComputedStyle(r).backgroundColor);
  });
  check('zebra persists under theme presets', zebraD[0] !== zebraD[1]);
  // stripe strength is per-theme: on hc black the stripe must be clearly visible
  await page.locator('#vTheme').selectOption('hc');
  await page.waitForTimeout(80);
  const hcStripe = await page.evaluate(() => getComputedStyle(document.querySelector('#vBody .vrow.alt')).backgroundColor);
  check('hc stripe is clearly visible (strong white over black)', hcStripe === 'rgba(255, 255, 255, 0.17)');
  await page.locator('#vTheme').selectOption('default');

  // ---------- 6. [Lnnn] toggle exists ----------
  check('[Lnnn] toggle present', await page.locator('#optLnnn').isChecked());

  // ---------- 6b. dark theme legibility (v1.18.5) ----------
  await page.locator('#tabBtnWork').click();
  await page.locator('#btnTheme').click();          // light -> dark
  const dk = await page.evaluate(() => {
    const cs = el => getComputedStyle(el);
    const tab = cs(document.querySelector('.tab.on'));
    const ts = cs(document.getElementById('tsFrom'));
    const vt = cs(document.getElementById('vTimeIn'));
    const lum = c => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255; };
    return {
      tabBg: tab.backgroundColor, tabColor: tab.color,
      tsBg: ts.backgroundColor, tsColor: ts.color,
      vtBg: vt.backgroundColor,
      contrast: Math.abs(lum(tab.backgroundColor) - lum(tab.color)),
    };
  });
  check('dark: active tab is accent with white text (not white-on-white)',
    dk.tabBg === 'rgb(77, 139, 255)' && dk.tabColor === 'rgb(255, 255, 255)' && dk.contrast > 0.3);
  check('dark: time-window + go-to-time inputs are dark-filled',
    dk.tsBg === 'rgb(13, 20, 27)' && dk.vtBg === 'rgb(13, 20, 27)');
  await page.locator('#btnTheme').click();          // restore light
  await page.locator('#tabBtnView').click();

  // ---------- 7. console errors ----------
  check('no page errors during flow', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));

  await browser.close();
  console.log('\nE2E RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E FATAL:', e.message); process.exit(1); });
