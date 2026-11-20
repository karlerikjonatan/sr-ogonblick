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

export function renderGallery(manifest) {
  validateManifest(manifest);
  const runs = [...manifest.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const archive = runs.map((run, index) => `
    <section class="run" aria-labelledby="run-${run.id}">
      <header class="run-heading">
        <h2 id="run-${run.id}"><time datetime="${escape(run.startedAt)}">${readableTime(run.startedAt)} Stockholm time</time></h2>
        <span>${index === 0 ? 'Latest run · ' : ''}${run.captures.length} captures</span>
      </header>
      ${run.pages.map((page) => `<article class="page" aria-labelledby="${run.id}-${page.id}">
        <header class="page-heading">
          <h3 id="${run.id}-${page.id}">${escape(page.title)}</h3>
          <div class="page-links">
            <a href="history.html?page=${encodeURIComponent(page.id)}" aria-label="View capture history for ${escape(page.title)}">View capture history</a>
            <a href="${escape(page.url)}">Source page <span aria-hidden="true">↗</span></a>
          </div>
        </header>
        <div class="pair">
          ${['desktop', 'mobile'].map((layout) => {
            const capture = run.captures.find((entry) => entry.pageId === page.id && entry.layout === layout);
            const label = layout === 'desktop' ? 'Desktop' : 'Mobile';
            return `<figure>
            <figcaption><strong>${label}</strong><span>${capture.width} × ${capture.height} px</span></figcaption>
            <a class="preview ${layout}" href="${escape(capture.image)}" aria-label="Open full ${label.toLowerCase()} screenshot of ${escape(page.title)}, ${readableTime(capture.capturedAt)} Stockholm time">
              <img src="${escape(capture.thumbnail)}" width="${capture.thumbnailWidth}" height="${capture.thumbnailHeight}" alt="${escape(page.title)} captured on ${label.toLowerCase()}" loading="lazy" decoding="async">
            </a>
            <p class="capture-time">Captured <time datetime="${escape(capture.capturedAt)}">${readableTime(capture.capturedAt)} Stockholm time</time> · <a href="${escape(capture.image)}">Full image</a></p>
          </figure>`;
          }).join('\n')}
        </div>
      </article>`).join('\n')}
    </section>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="A timestamped archive of Sveriges Radio pages, captured in desktop and mobile layouts.">
  <title>SR page snapshots</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <a class="skip" href="#archive">Skip to archive</a>
  <header class="masthead">
    <h1>SR page snapshots</h1>
    <p class="intro">Full-page snapshots, from top to bottom. Desktop and mobile, kept together.</p>
    <div class="archive-summary"><span>${runs.length} complete ${runs.length === 1 ? 'run' : 'runs'}</span><span>All times in Stockholm (CET/CEST)</span><a href="captures.json">Capture manifest</a></div>
  </header>
  <main id="archive">${archive || `
    <section class="empty">
      <h2>The archive starts here.</h2>
      <p>No captures yet. The first complete run will appear here with all four pages in desktop and mobile.</p>
    </section>`}
  </main>
  <footer>Independent screenshot archive. Source pages and their content belong to Sveriges Radio and their respective owners. Runs are added manually; this is not a live view.</footer>
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
