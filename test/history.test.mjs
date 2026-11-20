import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { renderGallery } from '../scripts/build-gallery.mjs';

const docs = new URL('../docs/', import.meta.url);
const base = 'https://archive.example/sr-page-snapshots/';
const saved = JSON.parse(await readFile(new URL('captures.json', docs), 'utf8'));
const manifest = { ...saved, runs: saved.runs.filter((run) => run.pages.some((page) => page.id === 'poddar')).slice(-2) };
const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', webp: 'image/webp' };
let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function openPage(t, { width = 390, archive = manifest } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  t.after(() => page.close());
  await page.route(`${base}**`, async (route) => {
    const url = new URL(route.request().url());
    const file = url.pathname.slice(new URL(base).pathname.length);
    if (file === 'captures.json') {
      return archive ? route.fulfill({ json: archive }) : route.fulfill({ status: 503 });
    }
    if (file === 'index.html') return route.fulfill({ contentType: 'text/html', body: renderGallery(manifest) });
    return route.fulfill({ contentType: types[file.split('.').at(-1)], body: await readFile(new URL(file, docs)) });
  });
  return page;
}

test('gallery opens a page-specific roll with all dates and lazy previews linking to full images', async (t) => {
  const archive = { ...manifest, runs: [...manifest.runs].reverse() };
  const page = await openPage(t, { archive });
  const fullRequests = [];
  page.on('request', (request) => {
    if (request.url().startsWith(`${base}screenshots/`)) fullRequests.push(request.url());
  });
  await page.goto(`${base}index.html`);
  await page.getByRole('link', { name: 'View capture history for Poddar', exact: true }).first().click();
  await page.getByRole('heading', { name: 'Poddar capture history' }).waitFor();
  assert.equal(page.url(), `${base}history.html?page=poddar`);
  const expected = [...manifest.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const columns = page.locator('.history-run');
  assert.deepEqual(await columns.locator('h2 time').evaluateAll((nodes) => nodes.map((node) => node.dateTime)),
    expected.map((run) => run.startedAt));
  for (const [index, run] of expected.entries()) {
    const previews = columns.nth(index).locator('a.preview');
    const captures = ['desktop', 'mobile'].map((layout) =>
      run.captures.find((capture) => capture.pageId === 'poddar' && capture.layout === layout));
    assert.deepEqual(await previews.evaluateAll((nodes) => nodes.map((node) => node.href)),
      captures.map((capture) => `${base}${capture.image}`));
    assert.deepEqual(await previews.locator('img').evaluateAll((nodes) =>
      nodes.map((image) => [image.src, image.loading])),
    captures.map((capture) => [`${base}${capture.thumbnail}`, 'lazy']));
  }
  await columns.first().locator('img').first().evaluate((image) => image.decode());
  const roll = page.getByRole('list', { name: 'Capture runs' });
  assert.ok(await roll.evaluate((node) => node.scrollWidth > node.clientWidth));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth));
  await roll.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('history-roll').scrollLeft > 0);
  assert.deepEqual(fullRequests, []);
});

test('history handles missing pages and unavailable manifests', async (t) => {
  const page = await openPage(t, { width: 1440, archive: { version: 1, runs: [] } });
  await page.goto(`${base}history.html?page=missing`);
  await page.getByText('No captures found for this page.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('list', { name: 'Capture runs' }).count(), 0);
  await page.route(`${base}captures.json`, (route) => route.fulfill({ status: 503 }));
  await page.reload();
  await page.getByText('Could not load capture history.', { exact: false }).waitFor();
  await page.getByRole('link', { name: 'Back to archive', exact: false }).click();
  assert.equal(page.url(), `${base}index.html`);
});
