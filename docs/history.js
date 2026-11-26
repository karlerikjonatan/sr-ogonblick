const title = document.querySelector('#history-title');
const status = document.querySelector('#history-status');
const roll = document.querySelector('#history-roll');
const stockholmTime = new Intl.DateTimeFormat('sv-SE', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Europe/Stockholm',
});

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

function captureFigure(capture, pageTitle) {
  const label = capture.layout === 'desktop' ? 'Dator' : 'Mobil';
  const figure = element('figure');
  const caption = element('figcaption');
  caption.append(element('strong', label), element('span', `${capture.width} × ${capture.height} px`));

  const link = element('a');
  link.className = `preview ${capture.layout}`;
  link.href = capture.image;
  link.setAttribute('aria-label', `Öppna hela skärmbilden av ${pageTitle} på ${label.toLowerCase()}, ${stockholmTime.format(new Date(capture.capturedAt))} svensk tid`);
  const thumbnail = element('img');
  thumbnail.alt = `${pageTitle} på ${label.toLowerCase()}`;
  thumbnail.width = capture.thumbnailWidth;
  thumbnail.height = capture.thumbnailHeight;
  thumbnail.loading = 'lazy';
  thumbnail.decoding = 'async';
  thumbnail.addEventListener('error', () => {
    link.replaceChildren(element('span', 'Förhandsvisningen är inte tillgänglig. Öppna hela bilden.'));
  }, { once: true });
  thumbnail.src = capture.thumbnail;
  link.append(thumbnail);

  const captured = element('p', 'Tagen ');
  captured.className = 'capture-time';
  captured.append(time(capture.capturedAt));
  figure.append(caption, link, captured);
  return figure;
}

async function showHistory() {
  const pageId = new URLSearchParams(location.search).get('page');
  if (!pageId) {
    status.textContent = 'Välj en sida i arkivet för att visa dess skärmbildshistorik.';
    return;
  }
  status.textContent = 'Laddar skärmbildshistorik…';
  const response = await fetch('captures.json', { cache: 'no-store' });
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
    status.textContent = 'Hittade inga skärmbilder för sidan. Välj en annan sida i arkivet.';
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
  title.textContent = `Skärmbildshistorik: ${entries[0].page.title}`;
  document.title = `${title.textContent} | SR Ögonblick`;
  status.textContent = `${entries.length} ${entries.length === 1 ? 'körning' : 'körningar'}. Välj en förhandsvisning för att öppna hela bilden.`;
  roll.append(columns);
  roll.hidden = false;
}

showHistory().catch((error) => {
  console.error('Kunde inte läsa in skärmbildshistoriken:', error);
  status.textContent = location.protocol === 'file:'
    ? 'Visa arkivet via HTTP för att bläddra i historiken lokalt.'
    : 'Kunde inte läsa in skärmbildshistoriken. Ladda om sidan eller gå tillbaka till arkivet.';
});
