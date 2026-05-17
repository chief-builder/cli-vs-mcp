import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        await page.goto('http://localhost:59998/login/index.html')

        # Fill in username
        await page.fill('input[name="username"], input[id="username"], input[type="text"]', 'alice')
        # Fill in password
        await page.fill('input[name="password"], input[id="password"], input[type="password"]', 'secret123')
        # Submit the form
        await page.click('button[type="submit"], input[type="submit"], button')

        # Wait for dashboard to load
        await page.wait_for_function(
            "document.body.innerText.includes('Welcome, alice!') && document.body.innerText.includes('DASHBOARD_LOADED')",
            timeout=10000
        )

        # Take screenshot
        await page.screenshot(
            path='/var/folders/h7/mhpz888d6xzcm62796jyks1c0000gn/T/clivsmcp-playwright-baseline-tier1_login-VjHjPU/login_landing.png',
            full_page=True
        )

        print('Screenshot saved successfully.')
        await browser.close()

asyncio.run(main())
