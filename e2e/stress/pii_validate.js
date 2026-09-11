/* Standalone PII audit validation on stress_c.log (1.5 GB) + heap check. */
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BIG = process.env.STRESS_DIR || path.join(os.tmpdir(), 'loglens_stress');
let pass = 0, fail = 0; const errors = [];
const check = (n, c, extra) => { c ? pass++ : fail++; console.log((c ? '  ok  ' : 'FAIL  ') + n + (c || !extra ? '' : ' — ' + extra)); };
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(20000);
  page.on('pageerror', e => errors.push(String(e).slice(0, 140)));
  await page.goto('file://' + path.resolve(__dirname, '..', '..', 'loglens.html'));
  await page.setInputFiles('#fpick', [
    path.join(BIG, 'stress_a.log'), path.join(BIG, 'stress_b.log'), path.join(BIG, 'stress_c.log'),
  ]);
  await page.waitForTimeout(1500);
  // audit only the 1.5 GB file: uncheck the two 2 GB files
  await page.evaluate(() => {
    document.querySelectorAll('#filelist .fileitem input[type=checkbox]').forEach((cb, i) => { cb.checked = i === 2; cb.dispatchEvent(new Event('change')); });
  });
  await page.waitForTimeout(300);
  await page.click('#tabBtnPii');
  await page.waitForTimeout(600);
  await page.click('#piiRun');
  const t0 = Date.now();
  let piiDone = false;
  for (let i = 0; i < 450; i++) {
    await page.waitForTimeout(4000);
    piiDone = await page.evaluate(() => document.getElementById('piiStop').disabled && !document.getElementById('piiRun').disabled);
    if (piiDone) break;
  }
  const wall = ((Date.now() - t0) / 1000).toFixed(0);
  check('PII audit completes over the 1.5 GB file', piiDone, 'wall ' + wall + ' s');
  const cdp = await page.context().newCDPSession(page);
  const heapMB = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
  void cdp;
  check('JS heap bounded after the audit (' + heapMB + ' MB < 400 MB)', heapMB < 400);
  check('zero page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  console.log('\nPII-VALIDATE RESULT: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
