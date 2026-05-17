const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:60100/login/index.html');

  await page.fill('input[name="username"], input#username, input[type="text"]', 'alice');
  await page.fill('input[name="password"], input#password, input[type="password"]', 'secret123');
  await page.click('button[type="submit"], input[type="submit"], button:has-text("Sign in"), button:has-text("Login"), button:has-text("Log in")');

  await page.waitForFunction(() => document.body.innerText.includes('Welcome, alice!'));
  await page.waitForFunction(() => document.body.innerText.includes('DASHBOARD_LOADED'));

  await page.screenshot({
    path: '/var/folders/h7/mhpz888d6xzcm62796jyks1c0000gn/T/clivsmcp-playwright-baseline-tier1_login-sJXRGp/login_landing.png',
    fullPage: true
  });

  console.log('Screenshot saved successfully.');
  await browser.close();
})();
