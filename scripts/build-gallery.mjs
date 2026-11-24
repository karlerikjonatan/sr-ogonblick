import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, validateFiles, validateManifest, withArchiveLock } from './archive.mjs';

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const readableTime = (value) => new Intl.DateTimeFormat('sv-SE', {
  dateStyle: 'long', timeStyle: 'medium', timeZone: 'Europe/Stockholm',
}).format(new Date(value));

function renderCapture(capture, page, layout, latest) {
  const label = layout === 'desktop' ? 'Dator' : 'Mobil';
  return `<figure class="capture${latest ? ' latest-capture' : ''}">
        <figcaption><time datetime="${escape(capture.capturedAt)}">${latest ? 'Senaste · ' : ''}${readableTime(capture.capturedAt)}</time><span>${capture.width} × ${capture.height} px</span></figcaption>
        <a class="preview ${layout}" href="${escape(capture.image)}" aria-label="Öppna hela skärmbilden av ${escape(page.title)} på ${label.toLowerCase()}, ${readableTime(capture.capturedAt)}">
          <img src="${escape(capture.thumbnail)}" width="${capture.thumbnailWidth}" height="${capture.thumbnailHeight}" alt="${escape(page.title)} på ${label.toLowerCase()}" loading="lazy" decoding="async">
        </a>
      </figure>`;
}

function renderLayout(page, runs, layout) {
  const label = layout === 'desktop' ? 'Dator' : 'Mobil';
  const captures = runs.slice(1).flatMap((run) => {
    const capture = run.captures.find((entry) => entry.pageId === page.id && entry.layout === layout);
    return capture ? [capture] : [];
  });
  const latestCapture = runs[0].captures.find((entry) => entry.pageId === page.id && entry.layout === layout);
  return `<section class="capture-view ${layout}" aria-label="Skärmbilder på ${label.toLowerCase()}">
      ${renderCapture(latestCapture, page, layout, true)}
${captures.length ? `      <ol class="previous-captures" aria-label="Tidigare skärmbilder på ${label.toLowerCase()}">
        ${captures.map((capture) => `<li>${renderCapture(capture, page, layout, false)}</li>`).join('\n')}
      </ol>
` : ''}    </section>`;
}

function renderPage(page, runs) {
  const pageId = escape(page.id);
  const desktopId = `layout-${pageId}-desktop`;
  const mobileId = `layout-${pageId}-mobile`;
  const comparisonUrl = `compare.html?page=${encodeURIComponent(page.id)}&layout=desktop`;
  return `<article class="page" aria-labelledby="page-${pageId}">
      <header class="page-heading">
        <h2 id="page-${pageId}">${escape(page.title)}</h2>
        <div class="page-actions">
          <a class="comparison-link" href="${escape(comparisonUrl)}" aria-label="Jämför skärmbilder av ${escape(page.title)}">Jämför skärmbilder</a>
          <a href="${escape(page.url)}">Källsida <span aria-hidden="true">↗</span></a>
        </div>
      </header>
      <fieldset class="layout-picker">
        <legend class="visually-hidden">Visningsläge</legend>
        <input id="${desktopId}" type="radio" name="layout-${pageId}" value="desktop" checked>
        <label for="${desktopId}">Dator</label>
        <input id="${mobileId}" type="radio" name="layout-${pageId}" value="mobile">
        <label for="${mobileId}">Mobil</label>
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
  const pageNav = latestRun ? `<nav class="page-nav" aria-label="Sidor">
      ${latestRun.pages.map((page) => `<a href="#page-${escape(page.id)}">${escape(page.title)}</a>`).join('\n      ')}
    </nav>` : '';
  return `<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="SR Ögonblick sparar ögonblicksbilder av Sveriges Radios webbsidor.">
  <title>SR Ögonblick</title>
  <link rel="icon" href="favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="styles.css">
  <script src="gallery.js" defer></script>
</head>
<body>
  <a class="skip" href="#archive">Hoppa till arkivet</a>
  <header class="masthead">
    <h1>SR Ögonblick</h1>
    <p class="intro">SR Ögonblick sparar ögonblicksbilder av Sveriges Radios webbsidor.</p>
${pageNav ? `    ${pageNav}\n` : ''}    <p class="archive-summary">${runs.length} ${runs.length === 1 ? 'körning' : 'körningar'}</p>
  </header>
  <main id="archive">${archive || `
    <section class="empty">
      <h2>Arkivet börjar här.</h2>
      <p>Inga skärmbilder ännu. Den första kompletta körningen visas här.</p>
    </section>`}
  </main>
  <footer>Källsidorna och deras innehåll tillhör Sveriges Radio och respektive rättighetsinnehavare. <a href="captures.json">Manifest över skärmbilder</a></footer>
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
