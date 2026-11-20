import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { acceptCookies, settlePage } from '../scripts/readiness.mjs';

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test('accepts all cookies rather than choosing a rejection control', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<main><h1>Poddar</h1></main><div role="dialog">
      <button onclick="window.choice='reject'">Avvisa alla</button>
      <button onclick="window.choice='all'; this.parentElement.remove()">Godkänn alla kakor</button>
      </div>`);
    await acceptCookies(page);
    assert.equal(await page.evaluate(() => window.choice), 'all');
  } finally { await page.close(); }
});

test('unknown consent prompt fails explicitly', { timeout: 20_000 }, async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div role="dialog">Vi använder kakor <button>Inställningar</button></div>');
    await assert.rejects(acceptCookies(page), /no known accept-all/);
  } finally { await page.close(); }
});

test('no consent prompt is valid and broken images fail loading', { timeout: 40_000 }, async () => {
  const page = await browser.newPage();
  try {
    await page.route('https://fixture.invalid/**', (route) => route.abort());
    await page.setContent(`<main><h2>Poddar</h2><a href="#1">One</a><a href="#2">Two</a>
      <a href="#3">Three</a><img width="100" height="100" src="https://fixture.invalid/missing.png"></main>`);
    await acceptCookies(page);
    await assert.rejects(settlePage(page), /Timeout/);
  } finally { await page.close(); }
});

test('scrolling loads initial lazy content, returns to top and never clicks show more', async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(`<main style="height:2600px"><h2>Poddar</h2>
      <a href="#1">One</a><a href="#2">Two</a><a href="#3">Three</a>
      <button onclick="window.clicked=true">Visa fler</button>
      <img style="margin-top:1700px" loading="lazy"
        src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">
      </main>`);
    await settlePage(page);
    assert.equal(await page.evaluate(() => window.scrollY), 0);
    assert.equal(await page.evaluate(() => !!window.clicked), false);
    await assert.rejects(settlePage(page, { maxScrolls: 1 }), /did not stabilize/);
  } finally { await page.close(); }
});
