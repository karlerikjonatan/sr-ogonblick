const title = document.querySelector('#history-title');
const status = document.querySelector('#history-status');
const roll = document.querySelector('#history-roll');
const utc = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'UTC',
});

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function time(value) {
  const node = element('time', utc.format(new Date(value)));
  node.dateTime = value;
  return node;
}

function captureFigure(capture, pageTitle) {
  const label = capture.layout === 'desktop' ? 'Desktop' : 'Mobile';
  const figure = element('figure');
  const caption = element('figcaption');
  caption.append(element('strong', label), element('span', `${capture.width} × ${capture.height} px`));

  const link = element('a');
  link.className = `preview ${capture.layout}`;
  link.href = capture.image;
  link.setAttribute('aria-label', `Open full ${label.toLowerCase()} screenshot of ${pageTitle}, ${utc.format(new Date(capture.capturedAt))} UTC`);
  const thumbnail = element('img');
  thumbnail.alt = `${pageTitle} on ${label.toLowerCase()}`;
  thumbnail.width = capture.thumbnailWidth;
  thumbnail.height = capture.thumbnailHeight;
  thumbnail.loading = 'lazy';
  thumbnail.decoding = 'async';
  thumbnail.addEventListener('error', () => {
    link.replaceChildren(element('span', 'Preview unavailable. Open full image.'));
  }, { once: true });
  thumbnail.src = capture.thumbnail;
  link.append(thumbnail);

  const captured = element('p', 'Captured ');
  captured.className = 'capture-time';
  captured.append(time(capture.capturedAt));
  figure.append(caption, link, captured);
  return figure;
}

async function showHistory() {
  const pageId = new URLSearchParams(location.search).get('page');
  if (!pageId) {
    status.textContent = 'Choose a page from the archive to view its capture history.';
    return;
  }
  status.textContent = 'Loading capture history…';
  const response = await fetch('captures.json');
  if (!response.ok) throw new Error(`Capture manifest returned HTTP ${response.status}`);
  const manifest = await response.json();
  if (manifest.version !== 1 || !Array.isArray(manifest.runs)) throw new Error('Invalid capture manifest');

  const entries = [...manifest.runs]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .flatMap((run) => {
      const page = run.pages.find((entry) => entry.id === pageId);
      return page ? [{ run, page }] : [];
    });
  if (entries.length === 0) {
    status.textContent = 'No captures found for this page. Choose another page from the archive.';
    return;
  }

  const columns = document.createDocumentFragment();
  for (const { run, page } of entries) {
    const column = element('li');
    column.className = 'history-run';
    const heading = element('h2');
    heading.append(time(run.startedAt));
    column.append(heading);
    for (const layout of ['desktop', 'mobile']) {
      const capture = run.captures.find((entry) => entry.pageId === pageId && entry.layout === layout);
      if (capture) column.append(captureFigure(capture, page.title));
    }
    columns.append(column);
  }
  title.textContent = `${entries[0].page.title} capture history`;
  document.title = `${title.textContent} | SR page snapshots`;
  status.textContent = `${entries.length} capture ${entries.length === 1 ? 'run' : 'runs'}. Select a preview to open the full image.`;
  roll.append(columns);
  roll.hidden = false;
}

showHistory().catch((error) => {
  console.error('Could not load capture history:', error);
  status.textContent = location.protocol === 'file:'
    ? 'Serve the archive over HTTP to browse capture history locally.'
    : 'Could not load capture history. Reload the page or return to the archive.';
});
