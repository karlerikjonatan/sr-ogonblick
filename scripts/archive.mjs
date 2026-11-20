import { access, cp, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const layouts = [
  { id: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
  { id: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
];

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export function validatePages(pages) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('No configured pages');
  const ids = new Set();
  for (const page of pages) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page.id) || ids.has(page.id)
      || typeof page.title !== 'string' || !page.title.trim()
      || new URL(page.url).origin !== 'https://www.sverigesradio.se') {
      throw new Error(`Invalid page configuration: ${page.id}`);
    }
    ids.add(page.id);
  }
}

export function timestampId(date = new Date()) {
  return date.toISOString().replaceAll(':', '-');
}

export function validateManifest(manifest) {
  if (manifest.version !== 1 || !Array.isArray(manifest.runs)) throw new Error('Invalid manifest');
  const ids = new Set();
  const paths = new Set();
  for (const run of manifest.runs) {
    if (!/^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z$/.test(run.id)
      || timestampId(new Date(run.startedAt)) !== run.id || ids.has(run.id)) {
      throw new Error(`Invalid or duplicate run: ${run.id}`);
    }
    ids.add(run.id);
    validatePages(run.pages);
    if (!Array.isArray(run.captures) || run.captures.length !== run.pages.length * layouts.length) {
      throw new Error(`Incomplete run: ${run.id}`);
    }
    const pairs = new Set();
    for (const capture of run.captures) {
      const page = run.pages.find((entry) => entry.id === capture.pageId);
      const layout = layouts.find((entry) => entry.id === capture.layout);
      const pair = `${capture.pageId}/${capture.layout}`;
      if (!page || !layout || pairs.has(pair) || capture.url !== page.url
        || !Number.isFinite(Date.parse(capture.capturedAt))
        || Date.parse(capture.capturedAt) < Date.parse(run.startedAt)
        || JSON.stringify(capture.viewport) !== JSON.stringify(layout.viewport)
        || capture.isMobile !== layout.isMobile || capture.hasTouch !== layout.hasTouch
        || capture.deviceScaleFactor !== layout.deviceScaleFactor
        || capture.width !== layout.viewport.width
        || !Number.isSafeInteger(capture.height) || capture.height < layout.viewport.height
        || !Number.isSafeInteger(capture.thumbnailWidth) || capture.thumbnailWidth < 1
        || !Number.isSafeInteger(capture.thumbnailHeight) || capture.thumbnailHeight < 1) {
        throw new Error(`Invalid capture: ${run.id}/${pair}`);
      }
      pairs.add(pair);
      for (const [field, folder] of [['image', 'screenshots'], ['thumbnail', 'thumbnails']]) {
        const expected = `${folder}/${pair}/${run.id}.webp`;
        if (capture[field] !== expected || paths.has(expected)) throw new Error(`Invalid capture path: ${capture[field]}`);
        paths.add(expected);
      }
    }
  }
  return manifest;
}

export async function validateFiles(docs, manifest) {
  validateManifest(manifest);
  for (const run of manifest.runs) {
    for (const capture of run.captures) {
      for (const file of [capture.image, capture.thumbnail]) {
        if (!(await stat(path.join(docs, file))).isFile() || (await stat(path.join(docs, file))).size === 0) {
          throw new Error(`Missing or empty image: ${file}`);
        }
      }
    }
  }
}

export async function withArchiveLock(root, action) {
  const lockPath = path.join(root, '.capture.lock');
  const lock = await open(lockPath, 'wx');
  try {
    await lock.writeFile(`${process.pid}\n`);
    return await action();
  } finally {
    await lock.close();
    await rm(lockPath);
  }
}

export async function stageRun({ root, pages, startedAt, capture, render }) {
  validatePages(pages);
  const docs = path.join(root, 'docs');
  const manifest = validateManifest(await readJson(path.join(docs, 'captures.json')));
  const id = timestampId(new Date(startedAt));
  if (manifest.runs.some((run) => run.id === id)) throw new Error(`Run timestamp collision: ${id}`);
  for (const page of pages) {
    for (const layout of layouts) {
      for (const folder of ['screenshots', 'thumbnails']) {
        const file = path.join(docs, folder, page.id, layout.id, `${id}.webp`);
        try {
          await access(file);
        } catch (error) {
          if (error.code === 'ENOENT') continue;
          throw error;
        }
        throw new Error(`Image collision: ${file}`);
      }
    }
  }
  const temporary = await mkdtemp(path.join(root, '.capture-'));
  const stagedDocs = path.join(temporary, 'docs');
  const backup = path.join(temporary, 'previous');
  let preserveBackup = false;
  try {
    await cp(docs, stagedDocs, { recursive: true, errorOnExist: true });
    const run = { id, startedAt, pages, captures: [] };
    for (const page of pages) {
      for (const layout of layouts) {
        const image = `screenshots/${page.id}/${layout.id}/${id}.webp`;
        const thumbnail = `thumbnails/${page.id}/${layout.id}/${id}.webp`;
        await mkdir(path.dirname(path.join(stagedDocs, image)), { recursive: true });
        await mkdir(path.dirname(path.join(stagedDocs, thumbnail)), { recursive: true });
        console.log(`Capturing ${page.id} / ${layout.id}`);
        const result = await capture({ page, layout, image: path.join(stagedDocs, image), thumbnail: path.join(stagedDocs, thumbnail) });
        run.captures.push({ ...result, pageId: page.id, url: page.url, layout: layout.id,
          viewport: layout.viewport, isMobile: layout.isMobile, hasTouch: layout.hasTouch,
          deviceScaleFactor: layout.deviceScaleFactor, image, thumbnail });
      }
    }
    const next = { version: 1, runs: [run, ...manifest.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
    await validateFiles(stagedDocs, next);
    await writeFile(path.join(stagedDocs, 'captures.json'), `${JSON.stringify(next, null, 2)}\n`);
    await writeFile(path.join(stagedDocs, 'index.html'), render(next));
    await rename(docs, backup);
    try {
      await rename(stagedDocs, docs);
    } catch (error) {
      preserveBackup = true;
      try {
        await rename(backup, docs);
        preserveBackup = false;
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], `Restore archive manually from ${backup}`);
      }
      throw error;
    }
    return run;
  } finally {
    if (!preserveBackup) await rm(temporary, { recursive: true, force: true });
  }
}
