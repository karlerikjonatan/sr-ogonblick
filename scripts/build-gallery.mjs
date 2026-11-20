import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, validateFiles, validateManifest, withArchiveLock } from './archive.mjs';

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const readableTime = (value) => new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Stockholm',
}).format(new Date(value));

function renderCapture(capture, page, layout, latest) {
  const label = layout === 'desktop' ? 'Desktop' : 'Mobile';
  return `<figure class="capture${latest ? ' latest-capture' : ''}">
        <figcaption><time datetime="${escape(capture.capturedAt)}">${latest ? 'Latest · ' : ''}${readableTime(capture.capturedAt)}</time><span>${capture.width} × ${capture.height} px</span></figcaption>
        <a class="preview ${layout}" href="${escape(capture.image)}" aria-label="Open full ${label.toLowerCase()} screenshot of ${escape(page.title)}, ${readableTime(capture.capturedAt)}">
          <img src="${escape(capture.thumbnail)}" width="${capture.thumbnailWidth}" height="${capture.thumbnailHeight}" alt="${escape(page.title)} captured on ${label.toLowerCase()}" loading="lazy" decoding="async">
        </a>
      </figure>`;
}

function renderLayout(page, runs, layout) {
  const label = layout === 'desktop' ? 'Desktop' : 'Mobile';
  const captures = runs.slice(1).flatMap((run) => {
    const capture = run.captures.find((entry) => entry.pageId === page.id && entry.layout === layout);
    return capture ? [capture] : [];
  });
  const latestCapture = runs[0].captures.find((entry) => entry.pageId === page.id && entry.layout === layout);
  return `<section class="capture-view ${layout}" aria-label="${label} captures">
      ${renderCapture(latestCapture, page, layout, true)}
${captures.length ? `      <ol class="previous-captures" aria-label="Earlier ${label.toLowerCase()} captures">
        ${captures.map((capture) => `<li>${renderCapture(capture, page, layout, false)}</li>`).join('\n')}
      </ol>
` : ''}    </section>`;
}

function renderPage(page, runs) {
  const pageId = escape(page.id);
  const desktopId = `layout-${pageId}-desktop`;
  const mobileId = `layout-${pageId}-mobile`;
  return `<article class="page" aria-labelledby="page-${pageId}">
      <header class="page-heading">
        <h2 id="page-${pageId}">${escape(page.title)}</h2>
        <a href="${escape(page.url)}">Source page <span aria-hidden="true">↗</span></a>
      </header>
      <fieldset class="layout-picker">
        <legend class="visually-hidden">Capture layout</legend>
        <input id="${desktopId}" type="radio" name="layout-${pageId}" value="desktop" checked>
        <label for="${desktopId}">Desktop</label>
        <input id="${mobileId}" type="radio" name="layout-${pageId}" value="mobile">
        <label for="${mobileId}">Mobile</label>
        ${renderLayout(page, runs, 'desktop')}
        ${renderLayout(page, runs, 'mobile')}
      </fieldset>
    </article>`;
}

export function renderGallery(manifest) {
  validateManifest(manifest);
  const runs = [...manifest.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const latestRun = runs[0];
  const archive = latestRun ? latestRun.pages.map((page) => renderPage(page, runs)).join('\n') : '';
  const pageNav = latestRun ? `<nav class="page-nav" aria-label="Pages">
      ${latestRun.pages.map((page) => `<a href="#page-${escape(page.id)}">${escape(page.title)}</a>`).join('\n      ')}
    </nav>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Timestamped full-page screenshots of Sveriges Radio pages.">
  <title>sr-page-snapshots</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <a class="skip" href="#archive">Skip to archive</a>
  <header class="masthead">
    <h1>sr-page-snapshots</h1>
    <p class="intro">Timestamped full-page screenshots of Sveriges Radio pages.</p>
${pageNav ? `    ${pageNav}\n` : ''}    <p class="archive-summary">${runs.length} ${runs.length === 1 ? 'run' : 'runs'}</p>
  </header>
  <main id="archive">${archive || `
    <section class="empty">
      <h2>The archive starts here.</h2>
      <p>No captures yet. The first complete run will appear here.</p>
    </section>`}
  </main>
  <footer>Source pages and their content belong to Sveriges Radio and their respective owners. <a href="captures.json">Capture manifest</a></footer>
</body>
</html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  withArchiveLock(root, async () => {
    const docs = path.join(root, 'docs');
    const manifest = await readJson(path.join(docs, 'captures.json'));
    await validateFiles(docs, manifest);
    await writeFile(path.join(docs, 'index.html'), renderGallery(manifest));
  }).catch((error) => { console.error(error); process.exitCode = 1; });
}
