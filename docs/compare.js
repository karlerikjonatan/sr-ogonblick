const title = document.querySelector('#comparison-title');
const status = document.querySelector('#comparison-status');
const roll = document.querySelector('#comparison-roll');
const layoutPicker = document.querySelector('.comparison-layout-picker');
const stockholmTime = new Intl.DateTimeFormat('sv-SE', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Stockholm',
});
const params = new URLSearchParams(location.search);
const pageId = params.get('page');
const requestedLayout = params.get('layout');
const selectedLayout = requestedLayout === 'mobile' ? 'mobile' : 'desktop';
let pageTitle = 'Skärmbild';
let captures = [];
layoutPicker.querySelector(`input[value="${selectedLayout}"]`).checked = true;

function element(tag, text) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
}

function time(value) {
  const node = element('time', `${stockholmTime.format(new Date(value))} svensk tid`);
  node.dateTime = value;
  return node;
}

function captureItem(capture, layout) {
  const label = layout === 'desktop' ? 'Dator' : 'Mobil';
  const figure = element('figure');
  figure.className = 'comparison-capture';
  const caption = element('figcaption');
  caption.append(time(capture.capturedAt), element('span', `${capture.width} × ${capture.height} px`));

  const link = element('a');
  link.className = 'comparison-image';
  link.href = capture.image;
  link.setAttribute('aria-label', `Öppna hela skärmbilden av ${pageTitle} på ${label.toLowerCase()}, ${stockholmTime.format(new Date(capture.capturedAt))} svensk tid`);
  const image = element('img');
  image.alt = `${pageTitle} på ${label.toLowerCase()}, tagen ${stockholmTime.format(new Date(capture.capturedAt))}`;
  image.width = capture.width;
  image.height = capture.height;
  image.loading = 'lazy';
  image.decoding = 'async';
  image.addEventListener('error', () => {
    link.removeAttribute('href');
    link.setAttribute('role', 'img');
    link.setAttribute('aria-label', `Bilden är inte tillgänglig: ${pageTitle} på ${label.toLowerCase()}`);
    link.replaceChildren(element('span', 'Bilden är inte tillgänglig.'));
  }, { once: true });
  image.src = capture.image;
  link.append(image);
  figure.append(caption, link);

  const item = element('li');
  item.append(figure);
  return item;
}

function showLayout(layout) {
  const label = layout === 'desktop' ? 'Dator' : 'Mobil';
  const selectedCaptures = captures.filter((capture) => capture.layout === layout);
  roll.replaceChildren();
  roll.setAttribute('aria-label', `Skärmbilder på ${label.toLowerCase()}`);

  if (selectedCaptures.length === 0) {
    roll.hidden = true;
    status.textContent = `Hittade inga skärmbilder för ${label.toLowerCase()} på sidan. Välj en annan sida i arkivet.`;
    return;
  }

  const items = document.createDocumentFragment();
  for (const capture of selectedCaptures) items.append(captureItem(capture, layout));
  roll.append(items);
  roll.hidden = false;
  const countLabel = selectedCaptures.length === 1 ? 'skärmbild' : 'skärmbilder';
  status.textContent = `${selectedCaptures.length} ${countLabel} på ${label.toLowerCase()}. Välj en bild för att öppna originalet.`;
}

async function showComparison() {
  if (!pageId) {
    status.textContent = 'Välj en sida i arkivet för att jämföra dess skärmbilder.';
    layoutPicker.hidden = true;
    return;
  }

  status.textContent = 'Laddar skärmbilder…';
  const response = await fetch('captures.json');
  if (!response.ok) throw new Error(`Capture manifest returned HTTP ${response.status}`);
  const manifest = await response.json();
  if (manifest.version !== 1 || !Array.isArray(manifest.runs)) throw new Error('Invalid capture manifest');

  const page = manifest.runs.find((run) => Array.isArray(run.pages)
    && run.pages.some((entry) => entry.id === pageId))?.pages.find((entry) => entry.id === pageId);
  if (!page) {
    status.textContent = 'Hittade inga skärmbilder för sidan. Välj en annan sida i arkivet.';
    layoutPicker.hidden = true;
    return;
  }

  pageTitle = page.title;
  title.textContent = `Skärmbilder: ${pageTitle}`;
  document.title = `${title.textContent} | SR Ögonblick`;
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
  console.error('Kunde inte läsa in jämförelsen av skärmbilder:', error);
  status.textContent = location.protocol === 'file:'
    ? 'Visa arkivet via HTTP för att jämföra skärmbilder lokalt.'
    : 'Kunde inte läsa in skärmbilderna. Ladda om sidan eller gå tillbaka till arkivet.';
});
