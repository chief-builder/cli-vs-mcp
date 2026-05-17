const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:59998/login/index.html');

  await page.fill('input[name="username"], input[id="username"], input[type="text"]', 'alice');
  await page.fill('input[name="password"], input[id="password"], input[type="password"]', 'secret123');
  await page.click('button[type="submit"], input[type="submit"], button');

  await page.waitForFunction(() => {
    const body = document.body.innerText;
    return body.includes('Welcome, alice!') && body.includes('DASHBOARD_LOADED');
  }, { timeout: 10000 });

  await page.screenshot({
    path: '/var/folders/h7/mhpz888d6xzcm62796jyks1c0000gn/T/clivsmcp-playwright-baseline-tier1_login-VjHjPU/login_landing.png',
    fullPage: true
  });

  console.log('Screenshot saved successfully.');
  await browser.close();
})();
