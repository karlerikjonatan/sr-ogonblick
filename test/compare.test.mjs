import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { timestampId } from '../scripts/archive.mjs';

const docs = new URL('../docs/', import.meta.url);
const base = 'https://archive.example/sr-ogonblick/';
const source = { id: 'poddar', title: 'Poddar', url: 'https://www.sverigesradio.se/poddar' };
const layouts = ['desktop', 'mobile'];
const runs = [
  { startedAt: '2026-01-02T23:30:00.000Z', dimensions: { desktop: [80, 80], mobile: [40, 40] } },
  { startedAt: '2026-07-01T22:30:00.000Z', dimensions: { desktop: [40, 80], mobile: [20, 40] } },
].map(({ startedAt, dimensions }) => {
  const id = timestampId(new Date(startedAt));
  return {
    id,
    startedAt,
    pages: [source],
    captures: layouts.map((layout, index) => {
      const [width, height] = dimensions[layout];
      return {
        pageId: source.id,
        layout,
        capturedAt: new Date(Date.parse(startedAt) + (index + 1) * 10_000).toISOString(),
        width,
        height,
        image: `screenshots/${source.id}/${layout}/${id}.webp`,
      };
    }),
  };
});
const manifest = { version: 1, runs };
const imageBuffers = new Map();
for (const run of runs) {
  for (const capture of run.captures) {
    imageBuffers.set(capture.image, await sharp({
      create: { width: capture.width, height: capture.height, channels: 3, background: '#ffffff' },
    }).webp().toBuffer());
  }
}
let browser;

before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

async function openPage(t, { width = 390, archive = manifest, imageFailure = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, timezoneId: 'America/Los_Angeles' });
  t.after(() => page.close());
  await page.route(`${base}**`, async (route) => {
    const url = new URL(route.request().url());
    const file = url.pathname.slice(new URL(base).pathname.length);
    if (file === 'captures.json') return route.fulfill({ json: archive });
    if (file === 'index.html') {
      return route.fulfill({ contentType: 'text/html', body: await readFile(new URL(file, docs)) });
    }
    if (file.startsWith('screenshots/')) {
      if (imageFailure) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: 'image/webp', body: imageBuffers.get(file) });
    }
    return route.fulfill({
      contentType: file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html',
      body: await readFile(new URL(file, docs)),
    });
  });
  return page;
}

test('archive comparison link preserves the selected layout and opens that page', async (t) => {
  const page = await openPage(t);
  await page.goto(`${base}index.html`);
  const archivePage = page.locator('.page').first();
  await archivePage.locator('label[for="layout-poddar-mobile"]').click();
  const comparisonLink = archivePage.getByRole('link', { name: 'Compare captures' });
  assert.equal(await comparisonLink.getAttribute('href'), 'compare.html?page=poddar&layout=mobile');
  await comparisonLink.click();

  await page.getByText('2 mobile captures.', { exact: false }).waitFor();
  assert.equal(page.url(), `${base}compare.html?page=poddar&layout=mobile`);
  assert.equal(await page.locator('#comparison-mobile').isChecked(), true);
  assert.equal(await page.locator('#comparison-roll li').count(), 2);
  assert.equal(await page.locator('#comparison-roll').getAttribute('aria-label'), 'Mobile captures');
});

test('comparison sorts captures newest first and preserves full-image proportions at one shared height', async (t) => {
  const page = await openPage(t);
  await page.goto(`${base}compare.html?page=poddar&layout=desktop`);
  const images = page.locator('.comparison-image img');
  await page.getByText('2 desktop captures.', { exact: false }).waitFor();
  assert.deepEqual(await page.locator('.comparison-capture time').evaluateAll((nodes) =>
    nodes.map((node) => node.dateTime)),
  runs.flatMap((run) => run.captures)
    .filter((capture) => capture.layout === 'desktop')
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .map((capture) => capture.capturedAt));
  assert.deepEqual(await page.locator('.comparison-image').evaluateAll((nodes) =>
    nodes.map((node) => node.href)),
  runs[1].captures.filter((capture) => capture.layout === 'desktop')
    .concat(runs[0].captures.filter((capture) => capture.layout === 'desktop'))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .map((capture) => `${base}${capture.image}`));
  assert.deepEqual(await images.evaluateAll((nodes) => nodes.map((image) => image.loading)), ['lazy', 'lazy']);

  await images.evaluateAll((nodes) => Promise.all(nodes.map((image) => {
    image.loading = 'eager';
    return image.decode();
  })));
  const metrics = await images.evaluateAll((nodes) => nodes.map((image) => {
    const bounds = image.getBoundingClientRect();
    return {
      height: bounds.height,
      ratio: bounds.width / bounds.height,
      naturalRatio: image.naturalWidth / image.naturalHeight,
      source: image.getAttribute('src'),
    };
  }));
  assert.equal(metrics[0].height, metrics[1].height);
  assert.ok(metrics.every((image) => Math.abs(image.ratio - image.naturalRatio) < 0.01));
  assert.ok(metrics.every((image) => image.source.startsWith('screenshots/')));
  const roll = page.getByRole('list', { name: 'Desktop captures' });
  assert.ok(await roll.evaluate((node) => node.scrollWidth > node.clientWidth));
  await roll.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.getElementById('comparison-roll').scrollLeft > 0);
});

test('comparison layout control changes the selected captures and URL', async (t) => {
  const page = await openPage(t);
  await page.goto(`${base}compare.html?page=poddar&layout=desktop`);
  await page.getByText('2 desktop captures.', { exact: false }).waitFor();

  await page.locator('label[for="comparison-mobile"]').click();
  assert.equal(await page.locator('#comparison-desktop').isChecked(), false);
  assert.equal(await page.locator('#comparison-roll').getAttribute('aria-label'), 'Mobile captures');
  assert.equal(new URL(page.url()).searchParams.get('layout'), 'mobile');
  assert.deepEqual(await page.locator('.comparison-capture time').evaluateAll((nodes) =>
    nodes.map((node) => node.dateTime)),
  runs.flatMap((run) => run.captures)
    .filter((capture) => capture.layout === 'mobile')
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
    .map((capture) => capture.capturedAt));
});

test('comparison handles missing pages, empty captures, and broken images', async (t) => {
  const page = await openPage(t, { archive: { version: 1, runs: [] } });
  await page.goto(`${base}compare.html?page=missing`);
  await page.getByText('No captures found for this page.', { exact: false }).waitFor();
  assert.equal(await page.locator('.comparison-roll').isHidden(), true);
  assert.equal(await page.locator('.comparison-layout-picker').isHidden(), true);

  const unavailable = await openPage(t, { imageFailure: true });
  await unavailable.goto(`${base}compare.html?page=poddar&layout=desktop`);
  await unavailable.getByText('Image unavailable.').first().waitFor();
  const fallback = unavailable.locator('.comparison-image').first();
  assert.equal(await fallback.getAttribute('href'), null);
  assert.equal(await fallback.getAttribute('role'), 'img');
});
