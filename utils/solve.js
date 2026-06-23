// Auto-solve Turnstile on the target page and log the resulting token.
// Setup:
//   npm i puppeteer-real-browser
//   node solve.js

const { connect } = require('puppeteer-real-browser');

const TARGET = 'https://apollouniversity.digiicampus.com/V2/#/home';

(async () => {
  const { browser, page } = await connect({
    headless: true,
    turnstile: true,      // auto-solve Turnstile checkbox
    disableXvfb: true,    // Windows
    ignoreAllFlags: false,
    customConfig: {
      protocolTimeout: 0 // Disable protocol timeout
    }
  });

  // Bump default timeouts — Apollo SPA + headless stealth can be slow
  page.setDefaultNavigationTimeout(1 * 60 * 1000);
  page.setDefaultTimeout(1 * 60 * 1000);

  try {
    console.log(`Navigating to ${TARGET}`);
    await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 5 * 60 * 1000 });

    // Wait for the Turnstile iframe to render (up to 5 min)
    console.log('Waiting for Turnstile widget...');
    // Wait for the program to auto captha go sleep


    console.log('Turnstile widget detected. Solving (auto)...');

    // Wait for the hidden input to be populated with the token (up to 5 min).
    // The input ID is dynamic (e.g. cf-chl-widget-ik7f1_response), so we
    // select by the stable `name` attribute instead.
    await page.waitForFunction(
      () => [...document.querySelectorAll('input[name="cf-turnstile-response"]')]
        .some(el => el.value && el.value.length > 0),
      { timeout: 5 * 60 * 1000, polling: 500 }
    );

    const results = await page.evaluate(() =>
      [...document.querySelectorAll('input[name="cf-turnstile-response"]')]
        .map(el => ({ id: el.id, name: el.name, value: el.value }))
    );

    console.log('\n=== TURNSTILE SOLVED ===');
    results.forEach((r, i) => {
      console.log(`\n[${i}] id:     ${r.id}`);
      console.log(`    name:  ${r.name}`);
      console.log(`    value: ${r.value || '(empty)'}`);
      console.log(`    len:   ${r.value.length}`);
    });
  } catch (err) {
    console.error(`\nFAILED — ${err.message}`);
  } finally {
    // Keep browser open a few seconds so you can see the green check, then close
    await new Promise(r => setTimeout(r, 3000));
    // Swallow Windows EPERM noise on Chrome temp-dir cleanup
    try { await browser.close(); } catch (_) { }
  }
})();
