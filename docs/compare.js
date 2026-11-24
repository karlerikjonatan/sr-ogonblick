const title = document.querySelector('#comparison-title');
const status = document.querySelector('#comparison-status');
const roll = document.querySelector('#comparison-roll');
const layoutPicker = document.querySelector('.comparison-layout-picker');
const stockholmTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Stockholm',
});
const params = new URLSearchParams(location.search);
const pageId = params.get('page');
const requestedLayout = params.get('layout');
const selectedLayout = requestedLayout === 'mobile' ? 'mobile' : 'desktop';
let pageTitle = 'Capture';
let captures = [];
layoutPicker.querySelector(`input[value="${selectedLayout}"]`).checked = true;

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function time(value) {
  const node = element('time', `${stockholmTime.format(new Date(value))} Stockholm time`);
  node.dateTime = value;
  return node;
}

function captureItem(capture, layout) {
  const label = layout === 'desktop' ? 'Desktop' : 'Mobile';
  const figure = element('figure');
  figure.className = 'comparison-capture';
  const caption = element('figcaption');
  caption.append(time(capture.capturedAt), element('span', `${capture.width} × ${capture.height} px`));

  const link = element('a');
  link.className = 'comparison-image';
  link.href = capture.image;
  link.setAttribute('aria-label', `Open full ${label.toLowerCase()} screenshot of ${pageTitle}, ${stockholmTime.format(new Date(capture.capturedAt))} Stockholm time`);
  const image = element('img');
  image.alt = `${pageTitle} on ${label.toLowerCase()}, captured ${stockholmTime.format(new Date(capture.capturedAt))}`;
  image.width = capture.width;
  image.height = capture.height;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => {
    link.removeAttribute('href');
    link.setAttribute('role', 'img');
    link.setAttribute('aria-label', `Image unavailable for ${pageTitle}, ${label.toLowerCase()} capture`);
    link.replaceChildren(element('span', 'Image unavailable.'));
  }, { once: true });
  image.src = capture.image;
  link.append(image);
  figure.append(caption, link);

  const item = element('li');
  item.append(figure);
  return item;
}

function showLayout(layout) {
  const label = layout === 'desktop' ? 'Desktop' : 'Mobile';
  const selectedCaptures = captures.filter((capture) => capture.layout === layout);
  roll.replaceChildren();
  roll.setAttribute('aria-label', `${label} captures`);

  if (selectedCaptures.length === 0) {
    roll.hidden = true;
    status.textContent = `No ${label.toLowerCase()} captures found for this page. Choose another page from the archive.`;
    return;
  }

  const items = document.createDocumentFragment();
  for (const capture of selectedCaptures) items.append(captureItem(capture, layout));
  roll.append(items);
  roll.hidden = false;
  status.textContent = `${selectedCaptures.length} ${label.toLowerCase()} ${selectedCaptures.length === 1 ? 'capture' : 'captures'}. Select an image to open the original.`;
}

async function showComparison() {
  if (!pageId) {
    status.textContent = 'Choose a page from the archive to compare its captures.';
    layoutPicker.hidden = true;
    return;
  }

  status.textContent = 'Loading captures…';
  const response = await fetch('captures.json');
  if (!response.ok) throw new Error(`Capture manifest returned HTTP ${response.status}`);
  const manifest = await response.json();
  if (manifest.version !== 1 || !Array.isArray(manifest.runs)) throw new Error('Invalid capture manifest');

  const page = manifest.runs.find((run) => Array.isArray(run.pages)
    && run.pages.some((entry) => entry.id === pageId))?.pages.find((entry) => entry.id === pageId);
  if (!page) {
    status.textContent = 'No captures found for this page. Choose another page from the archive.';
    layoutPicker.hidden = true;
    return;
  }

  pageTitle = page.title;
  title.textContent = `${pageTitle} captures`;
  document.title = `${title.textContent} | SR page snapshots`;
  captures = manifest.runs.flatMap((run) => Array.isArray(run.captures) ? run.captures : [])
    .filter((capture) => capture.pageId === pageId)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  if (captures.some((capture) => !['desktop', 'mobile'].includes(capture.layout)
    || !Number.isFinite(Date.parse(capture.capturedAt))
    || !Number.isSafeInteger(capture.width) || capture.width < 1
    || !Number.isSafeInteger(capture.height) || capture.height < 1
    || typeof capture.image !== 'string' || !capture.image)) {
    throw new Error('Invalid capture data');
  }

  showLayout(selectedLayout);
}

layoutPicker.addEventListener('change', (event) => {
  if (!event.target.matches('input[type="radio"]')) return;
  params.set('layout', event.target.value);
  window.history.replaceState(null, '', `${location.pathname}?${params}`);
  showLayout(event.target.value);
});

showComparison().catch((error) => {
  console.error('Could not load capture comparison:', error);
  status.textContent = location.protocol === 'file:'
    ? 'Serve the archive over HTTP to compare captures locally.'
    : 'Could not load captures. Reload the page or return to the archive.';
});
