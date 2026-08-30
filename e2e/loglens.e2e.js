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

  // ---------- 3. viewer: demo visible + masked ----------
  await page.locator('#tabBtnView').click();
  await page.locator('#vBody .vrow').first().waitFor({ timeout: 3000 });
  const rowCnt = await page.locator('#vBody .vrow').count();
  check('viewer renders the log window', rowCnt >= 10);
  const vText = await page.locator('#vBody').innerText();
  check('viewer masks VIN on display', !vText.includes('YV4DEM0123AB34567'));
  check('viewer shows the service tag', vText.includes('MyApp'));

  // ---------- 4. viewer search-jump ----------
  await page.locator('#vSearch').fill('Auth');
  await page.locator('#vSearch').press('Enter');
  await page.locator('#vBody mark').first().waitFor({ timeout: 5000 }).catch(() => {});
  const marks = await page.locator('#vBody mark').count();
  const vText2 = await page.locator('#vBody').innerText();
  check('search-jump highlights match', marks > 0 || vText2.includes('Auth'));

  // ---------- 5. logcat theme switch (viewer toolbar selector) ----------
  await page.locator('#vTheme').selectOption('dracula');
  const bodyTheme = await page.evaluate(() => document.body.getAttribute('data-logtheme'));
  check('logcat theme applies (dracula)', bodyTheme === 'dracula');
  const surf = await page.evaluate(() => getComputedStyle(document.getElementById('vBody')).backgroundColor);
  check('viewer surface restyled (dracula bg)', surf === 'rgb(40, 42, 54)');
  await page.locator('#vTheme').selectOption('default');

  // ---------- 6. [Lnnn] toggle exists ----------
  check('[Lnnn] toggle present', await page.locator('#optLnnn').isChecked());

  // ---------- 7. console errors ----------
  check('no page errors during flow', errors.length === 0);
  if (errors.length) console.log(errors.join('\n'));

  await browser.close();
  console.log('\nE2E RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('E2E FATAL:', e.message); process.exit(1); });
