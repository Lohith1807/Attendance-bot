const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { connect } = require('puppeteer-real-browser');

// Automatically set CHROME_PATH if not set by user
const fs = require('fs');
if (!process.env.CHROME_PATH) {
    // 1. Check local ./browser folder (if downloaded manually)
    const browserDir = path.join(__dirname, '../browser/chrome');
    let found = false;
    if (fs.existsSync(browserDir)) {
        const platforms = fs.readdirSync(browserDir);
        for (const platform of platforms) {
            const exePath = path.join(browserDir, platform, 'chrome-linux64', 'chrome');
            if (fs.existsSync(exePath)) {
                process.env.CHROME_PATH = exePath;
                console.log(`[Auto-Config] Found local Chrome at: ${exePath}`);
                found = true;
                break;
            }
        }
    }
    
    // 2. Fallback to Puppeteer's default cache
    if (!found) {
        try {
            const puppeteer = require('puppeteer');
            const chromePath = puppeteer.executablePath();
            if (chromePath && fs.existsSync(chromePath)) {
                process.env.CHROME_PATH = chromePath;
                console.log(`[Auto-Config] Found Puppeteer Chrome at: ${chromePath}`);
            }
        } catch (err) {}
    }
}
const TARGET = 'https://apollouniversity.digiicampus.com/V2/#/home';

// Load credentials from .env
const REG_NO = process.env.REG_NO;
const PASSWORD = process.env.PASSWORD;

(async () => {
    if (!REG_NO || !PASSWORD) {
        console.error("❌ ERROR: REG_NO or PASSWORD is missing in your .env file!");
        process.exit(1);
    }

    const { browser, page } = await connect({
        headless: false,
        turnstile: true,
        disableXvfb: true,
        ignoreAllFlags: false,
        customConfig: {
            protocolTimeout: 0
        }
    });

    page.setDefaultNavigationTimeout(1 * 60 * 1000);
    page.setDefaultTimeout(1 * 60 * 1000);

    try {
        console.log(`Navigating to ${TARGET}`);
        await page.goto(TARGET, { waitUntil: 'networkidle2', timeout: 5 * 60 * 1000 });

        // Wait for Turnstile to be solved
        console.log('Waiting for Turnstile widget to be solved...');
        await page.waitForFunction(
            () => [...document.querySelectorAll('input[name="cf-turnstile-response"]')].some(el => el.value && el.value.length > 0),
            { timeout: 5 * 60 * 1000, polling: 500 }
        );
        console.log('✅ Turnstile solved!');

        // Wait for the login form to be visible (using the selectors from your screenshot)
        console.log('Waiting for login form...');
        await page.waitForSelector('#registrationId', { visible: true });

        // Type the credentials
        console.log('Entering credentials...');
        await page.waitForSelector('#registrationId', { visible: true });
        
        // Use evaluate to set value and dispatch events (React-friendly way)
        await page.evaluate((id, pwd) => {
            const idField = document.querySelector('#registrationId');
            const pwdField = document.querySelector('#password');
            
            // React specific value setter
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            
            nativeInputValueSetter.call(idField, id);
            idField.dispatchEvent(new Event('input', { bubbles: true }));
            
            nativeInputValueSetter.call(pwdField, pwd);
            pwdField.dispatchEvent(new Event('input', { bubbles: true }));
        }, REG_NO, PASSWORD);
        
        await new Promise(r => setTimeout(r, 1000));

        // Submit the form
        console.log('Submitting form...');
        // We attempt to click the submit button. Since we don't have its ID, we look for a submit button.
        const loginButton = await page.$('button[type="submit"]');
        if (loginButton) {
            await loginButton.click();
            console.log('✅ Clicked login, waiting for redirect...');
            // Wait for 20 seconds to allow the SPA to process the login and set tokens
            await new Promise(r => setTimeout(r, 20000));
            await page.screenshot({path: path.join(__dirname, '../data/screenshot.png'), fullPage: true});
            console.log('✅ Login wait complete. Screenshot saved.');

            console.log('\n--- Extracting Authentication Data ---');

            // 1. Get Cookies
            const cookies = await page.cookies();

            // 2. Get LocalStorage (Often holds JWTs)
            const localStorageData = await page.evaluate(() => {
                const data = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    data[key] = localStorage.getItem(key);
                }
                return data;
            });

            // 3. Get SessionStorage
            const sessionStorageData = await page.evaluate(() => {
                const data = {};
                for (let i = 0; i < sessionStorage.length; i++) {
                    const key = sessionStorage.key(i);
                    data[key] = sessionStorage.getItem(key);
                }
                return data;
            });

            try {
                const userInfo = JSON.parse(localStorageData.userInfo);
                const token = userInfo.token;

                // Dump ONLY the token to the file
                require('fs').writeFileSync(path.join(__dirname, '../data/auth_dump.json'), JSON.stringify({
                    token: token
                }, null, 2));

                console.log('✅ Auth token saved to auth_dump.json');
                console.log('\n🔑 EXTRACTED TOKEN:', token);
            } catch(e) {
                console.log('\n⚠️ Could not parse token from localStorage. Data not saved.');
            }
            
            console.log('\n--------------------------------------\n');

        } else {
            console.error("❌ Could not find the submit button. Please update the button selector in click.js.");
        }

    } catch (err) {
        console.error(`\nFAILED — ${err.message}`);
    } finally {
        console.log('Finished. Closing browser in 5 seconds...');
        await new Promise(r => setTimeout(r, 5000));
        try { await browser.close(); } catch (_) { }
    }
})();
