const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:50907/recovery/index.html');

  // Fill the form with initial values
  await page.fill('[name="name"], #name, input[placeholder*="Name"]', 'Test User');
  await page.fill('[name="email"], #email, input[placeholder*="Email"]', 'test@example.com');
  await page.fill('[name="code"], #code, input[placeholder*="code"], input[placeholder*="Code"]', 'unknown');

  // Click Verify
  await page.click('button:has-text("Verify"), input[value="Verify"]');

  // Wait for error message
  await page.waitForSelector('.error');

  // Read all error messages
  const errors = await page.$$eval('.error', els => els.map(el => ({
    text: el.textContent,
    id: el.id,
    className: el.className,
    html: el.outerHTML
  })));
  console.log('ERRORS:', JSON.stringify(errors, null, 2));

  // Get full page HTML to understand structure
  const html = await page.content();
  console.log('PAGE_HTML:', html);

  await browser.close();
})();
