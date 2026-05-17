const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:60140/login/index.html');

  await page.fill('input[name="username"], input#username, input[type="text"]', 'alice');
  await page.fill('input[name="password"], input#password, input[type="password"]', 'secret123');
  await page.click('button[type="submit"], input[type="submit"], button');

  await page.waitForFunction(() => {
    return document.body.innerText.includes('Welcome, alice!') &&
           document.body.innerText.includes('DASHBOARD_LOADED');
  }, { timeout: 10000 });

  await page.screenshot({
    path: '/var/folders/h7/mhpz888d6xzcm62796jyks1c0000gn/T/clivsmcp-playwright-baseline-tier1_login-kQ2YAB/login_landing.png',
    fullPage: true
  });

  await browser.close();
  console.log('Screenshot saved successfully.');
})();
