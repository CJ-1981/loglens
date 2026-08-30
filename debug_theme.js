const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto('file://' + path.resolve(__dirname, 'loglens.html'));

  // load demo + switch to viewer (so #vTheme is visible)
  await page.locator('#btnDemo').click();
  await page.locator('#tabBtnView').click();
  await page.locator('#vBody .vrow').first().waitFor({ timeout: 3000 });

  await page.locator('#vTheme').selectOption('dracula');
  await page.waitForTimeout(200);
  const state = await page.evaluate(() => ({
    attr: document.body.getAttribute('data-logtheme'),
    hasAttr: document.body.hasAttribute('data-logtheme'),
    allAttrs: [...document.body.attributes].map(a => a.name + '=' + a.value),
    vThemeValue: document.getElementById('vTheme').value,
    vBodyClass: document.getElementById('vBody').className,
    bg: getComputedStyle(document.getElementById('vBody')).backgroundColor,
    logThemeSelValue: document.getElementById('logThemeSel') ? document.getElementById('logThemeSel').value : null,
  }));
  console.log(JSON.stringify(state, null, 1));
  console.log('pageerrors:', errs.length ? errs.join(' | ') : 'none');
  await browser.close();
})();
