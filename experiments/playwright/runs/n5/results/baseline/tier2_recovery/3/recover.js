const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = 'http://localhost:60645/recovery/index.html';
  const outputPath = '/var/folders/h7/mhpz888d6xzcm62796jyks1c0000gn/T/clivsmcp-playwright-baseline-tier2_recovery-qk6Oam/recovery_token.txt';

  await page.goto(url);

  let token = null;
  let attempts = 0;

  while (!token && attempts < 10) {
    attempts++;

    // Check for success block with token
    const tokenEl = await page.$('#token');
    if (tokenEl) {
      token = await tokenEl.textContent();
      token = token.trim();
      break;
    }

    // Fill form fields (keep name and email, update code each round)
    await page.fill('[name="name"], #name, input[placeholder*="name" i]', '');
    // Try to find fields by label or common selectors
    const nameField = await page.$('input[name="name"], input#name, input[type="text"]:first-of-type');
    const emailField = await page.$('input[name="email"], input#email, input[type="email"]');
    const codeField = await page.$('input[name="code"], input[name="verification"], input[name="verificationCode"], input#code');

    if (nameField) await nameField.fill('Test User');
    if (emailField) await emailField.fill('test@example.com');

    // Determine what code to use
    let code = 'unknown';
    if (attempts > 1) {
      // Read error message to get correct code
      const errorEl = await page.$('.error');
      if (errorEl) {
        const errorText = await errorEl.textContent();
        console.log('Error text:', errorText);
        // Extract code from error message - look for hex-like or alphanumeric code
        const match = errorText.match(/([0-9a-fA-F]{4,}|[A-Z0-9]{4,})/);
        if (match) {
          code = match[1];
          console.log('Extracted code:', code);
        }
      }
    }

    if (codeField) await codeField.fill(code);

    // Click verify button
    const verifyBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Verify"), button');
    if (verifyBtn) await verifyBtn.click();

    await page.waitForTimeout(1000);

    // Check for token after submission
    const tokenElAfter = await page.$('#token');
    if (tokenElAfter) {
      token = await tokenElAfter.textContent();
      token = token.trim();
      break;
    }
  }

  if (token) {
    const fs = require('fs');
    fs.writeFileSync(outputPath, token);
    console.log('Token saved:', token);
  } else {
    console.log('Failed to get token after', attempts, 'attempts');
  }

  await browser.close();
})();
