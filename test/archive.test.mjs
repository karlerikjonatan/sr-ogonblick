import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { layouts, stageRun, validateManifest, validatePages, withArchiveLock } from '../scripts/archive.mjs';
import { renderGallery } from '../scripts/build-gallery.mjs';

const pages = [
  { id: 'one', title: 'One & two', heading: 'One', url: 'https://www.sverigesradio.se/poddar' },
  { id: 'two', title: 'Two', heading: 'Two', url: 'https://www.sverigesradio.se/barn' },
];
const startedAt = '2026-11-20T08:00:00.000Z';

test('SR targets are accepted while unrelated origins are rejected', () => {
  validatePages(pages);
  assert.throws(() => validatePages([{ ...pages[0], url: 'https://unrelated.example/poddar' }]), /Invalid page/);
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sr-snapshots-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'docs'));
  await writeFile(path.join(root, 'docs/captures.json'), JSON.stringify({ version: 1, runs: [] }));
  await writeFile(path.join(root, 'docs/index.html'), 'previous site');
  return root;
}

async function fakeCapture({ layout, image, thumbnail }) {
  await writeFile(image, 'image fixture');
  await writeFile(thumbnail, 'thumbnail fixture');
  return { capturedAt: startedAt, width: layout.viewport.width, height: 1200, thumbnailWidth: 360, thumbnailHeight: 840 };
}

test('capture failure preserves the previous manifest and site and cleans staging', async (t) => {
  const root = await fixture(t);
  const before = await readFile(path.join(root, 'docs/captures.json'), 'utf8');
  let count = 0;
  await assert.rejects(stageRun({ root, pages, startedAt, render: renderGallery, capture: async (options) => {
    if (++count === 3) throw new Error('loading failed');
    return fakeCapture(options);
  } }), /loading failed/);
  assert.equal(await readFile(path.join(root, 'docs/captures.json'), 'utf8'), before);
  assert.equal(await readFile(path.join(root, 'docs/index.html'), 'utf8'), 'previous site');
  assert.deepEqual((await readdir(root)).sort(), ['docs']);
});

test('incomplete or invalid captures are rejected before replacing the archive', async (t) => {
  const root = await fixture(t);
  await assert.rejects(stageRun({ root, pages, startedAt, render: renderGallery, capture: async (options) => ({
    ...await fakeCapture(options), width: 1,
  }) }), /Invalid capture/);
  assert.equal(await readFile(path.join(root, 'docs/index.html'), 'utf8'), 'previous site');
});

test('complete runs validate, collisions never overwrite, missing pairs are invalid', async (t) => {
  const root = await fixture(t);
  const run = await stageRun({ root, pages, startedAt, render: renderGallery, capture: fakeCapture });
  assert.equal(run.captures.length, pages.length * layouts.length);
  validateManifest({ version: 1, runs: [run] });
  await assert.rejects(stageRun({ root, pages, startedAt, render: renderGallery, capture: fakeCapture }), /collision/);
  assert.throws(() => validateManifest({ version: 1, runs: [{ ...run, captures: run.captures.slice(1) }] }), /Incomplete/);
  const invalid = structuredClone(run);
  invalid.captures[0].image = '../outside.webp';
  assert.throws(() => validateManifest({ version: 1, runs: [invalid] }), /Invalid capture path/);
  const duplicate = structuredClone(run);
  duplicate.captures[1] = duplicate.captures[0];
  assert.throws(() => validateManifest({ version: 1, runs: [duplicate] }), /Invalid capture/);
});

test('orphaned filename collisions fail before invoking capture', async (t) => {
  const root = await fixture(t);
  const folder = path.join(root, 'docs/screenshots/one/desktop');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, '2026-11-20T08-00-00.000Z.webp'), 'keep');
  await assert.rejects(stageRun({ root, pages, startedAt, render: renderGallery,
    capture: () => assert.fail('must not capture') }), /collision/);
});

test('render failures preserve archive and lock excludes concurrent writers', async (t) => {
  const root = await fixture(t);
  await withArchiveLock(root, async () => {
    await assert.rejects(withArchiveLock(root, () => assert.fail('must not acquire')), { code: 'EEXIST' });
    await assert.rejects(stageRun({ root, pages, startedAt, capture: fakeCapture,
      render: () => { throw new Error('render failed'); } }), /render failed/);
  });
  assert.equal(await readFile(path.join(root, 'docs/index.html'), 'utf8'), 'previous site');
  assert.deepEqual(await readdir(root), ['docs']);
});

test('gallery orders newest runs first, preserves page order, escapes titles and uses relative links', async (t) => {
  const root = await fixture(t);
  const first = await stageRun({ root, pages, startedAt, render: renderGallery, capture: fakeCapture });
  const laterTime = '2026-11-21T08:00:00.000Z';
  const later = await stageRun({ root, pages, startedAt: laterTime, render: renderGallery,
    capture: async (options) => ({ ...await fakeCapture(options), capturedAt: laterTime }) });
  const html = renderGallery({ version: 1, runs: [first, later] });
  assert.ok(html.indexOf('datetime="2026-11-21T08:00:00.000Z"')
    < html.indexOf('datetime="2026-11-20T08:00:00.000Z"'));
  assert.ok(html.indexOf('<h2 id="page-one">') < html.indexOf('<h2 id="page-two">'));
  assert.match(html, /href="#page-one">One &amp; two<\/a>/);
  assert.match(html, /href="#page-two">Two<\/a>/);
  assert.match(html, /One &amp; two/);
  assert.match(html, /20 November 2026 at 09:00:00/);
  assert.doesNotMatch(html, /Stockholm time/);
  assert.match(html, /<p class="archive-summary">2 runs<\/p>/);
  assert.match(html, /datetime="2026-11-20T08:00:00\.000Z"/);
  assert.doesNotMatch(html, /\bUTC\b/);
  assert.match(html, /name="layout-one" value="desktop" checked/);
  assert.match(html, /name="layout-one" value="mobile"/);
  assert.match(html, /class="capture-view desktop" aria-label="Desktop captures"/);
  assert.match(html, /Earlier desktop captures/);
  for (const capture of later.captures) {
    assert.ok(html.includes(`href="${capture.image}"`));
    assert.ok(html.includes(`src="${capture.thumbnail}"`));
  }
  assert.doesNotMatch(html, /(?:src|href)="\/(?:screenshots|thumbnails|styles)/);
});

test('gallery displays winter and summer Stockholm dates while retaining UTC datetime values', async (t) => {
  const root = await fixture(t);
  const winterAt = '2026-01-02T23:30:00.000Z';
  const summerAt = '2026-07-01T22:30:00.000Z';
  const winter = await stageRun({ root, pages, startedAt: winterAt, render: renderGallery,
    capture: async (options) => ({ ...await fakeCapture(options), capturedAt: winterAt }) });
  const summer = await stageRun({ root, pages, startedAt: summerAt, render: renderGallery,
    capture: async (options) => ({ ...await fakeCapture(options), capturedAt: summerAt }) });
  const html = renderGallery({ version: 1, runs: [winter, summer] });
  assert.match(html, /2 July 2026 at 00:30:00 Stockholm time/);
  assert.match(html, /3 January 2026 at 00:30:00 Stockholm time/);
  assert.match(html, /datetime="2026-07-01T22:30:00\.000Z"/);
  assert.match(html, /datetime="2026-01-02T23:30:00\.000Z"/);
});
