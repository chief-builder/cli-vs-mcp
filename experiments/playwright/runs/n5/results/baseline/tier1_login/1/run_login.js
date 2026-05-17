const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:59967/login/index.html');

  await page.fill('[name="username"], #username, input[type="text"]', 'alice');
  await page.fill('[name="password"], #password, input[type="password"]', 'secret123');
  await page.click('[type="submit"], button[type="submit"], input[type="submit"]');

  await page.waitForSelector('text=Welcome, alice!', { timeout: 10000 });
  await page.waitForSelector('text=DASHBOARD_LOADED', { timeout: 10000 });

  await page.screenshot({
    path: '/var/folders/h7/mhpz888d6xzcm62796jyks1c0000gn/T/clivsmcp-playwright-baseline-tier1_login-fiH6iX/login_landing.png',
    fullPage: true,
  });

  await browser.close();
  console.log('Screenshot saved.');
})();
