for (const page of document.querySelectorAll('.page')) {
  const link = page.querySelector('.comparison-link');
  if (!link) continue;

  page.addEventListener('change', (event) => {
    if (!event.target.matches('input[type="radio"][name^="layout-"]')) return;
    const query = new URLSearchParams(link.search);
    query.set('layout', event.target.value);
    link.setAttribute('href', `compare.html?${query}`);
  });
}
